import {
  type Recipe,
  hasConfig,
  listRecipes,
  readConfig,
  readRecipe,
  removeSecret,
  wirePhantomForRecipe,
  writeConfig,
} from "@ashlr/stack-core";
import { removeMcpEntry } from "@ashlr/stack-core/mcp-writer";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError, prompts } from "../ui.ts";
import { addCommand } from "./add.ts";
import { doctorCommand } from "./doctor.ts";
import { initCommand } from "./init.ts";

/**
 * `stack apply [recipe-id]` — replay a frozen Recipe through the add pipeline
 * and pre-wire Phantom envelopes + webhook stubs so the provider-specific
 * flows land real credentials into already-rotating slots.
 *
 * This is the moat: recommendation → TOML → `apply` → provisioned stack,
 * with secret rotation wired from the first call.
 */
export const applyCommand = defineCommand({
  meta: {
    name: "apply",
    description: "Apply a saved recipe: provision each provider + pre-wire Phantom rotation.",
  },
  args: {
    recipeId: {
      type: "positional",
      required: false,
      description: "Recipe id (filename stem in .stack/recipes). Omit for picker.",
    },
    noWire: {
      type: "boolean",
      default: false,
      description: "Skip Phantom envelope + webhook pre-wiring (opts out of the moat).",
    },
    noRollback: {
      type: "boolean",
      default: false,
      description:
        "On partial failure, leave successfully-added services in .stack.toml instead of rolling them back.",
    },
  },
  async run({ args }) {
    intro(`stack apply${args.noWire ? colors.dim(" (no-wire)") : ""}`);

    // The marketed golden path is `stack recommend --save && stack apply <id>`,
    // which must work from a blank directory. Auto-init if no .stack.toml so
    // the user isn't forced through a template picker they never asked for.
    if (!hasConfig()) {
      console.log(colors.dim("  ○ no .stack.toml — auto-running `stack init --noInteractive`"));
      try {
        await initCommand.run?.({
          args: { noInteractive: true, force: false, _: [] },
          cmd: initCommand,
          rawArgs: ["--noInteractive"],
          data: undefined,
        } as unknown as Parameters<NonNullable<typeof initCommand.run>>[0]);
      } catch (err) {
        outroError(`Auto-init failed: ${(err as Error).message}`);
        return;
      }
      if (!hasConfig()) {
        outroError("Auto-init did not produce a .stack.toml. Run `stack init` manually.");
        return;
      }
    }

    const recipe = await pickRecipe(args.recipeId ? String(args.recipeId) : undefined);
    if (!recipe) return; // pickRecipe already surfaced the error.

    console.log();
    console.log(`  ${colors.bold("recipe")}   ${recipe.id}`);
    console.log(`  ${colors.dim("query")}    ${recipe.query}`);
    console.log(`  ${colors.dim("providers")} ${recipe.providers.map((p) => p.name).join(", ")}`);
    console.log();

    // Re-run addCommand for each provider. We intentionally do NOT parallelize:
    // some providers (e.g. Vercel) need cwd state written by earlier steps
    // and interactive prompts don't interleave cleanly.
    const succeeded: string[] = [];
    const failures: Array<{ name: string; message: string }> = [];
    for (const { name } of recipe.providers) {
      try {
        console.log(colors.dim(`  › stack add ${name}`));
        // citty's CommandContext type requires every declared arg key; we
        // only set the ones addCommand actually reads, so cast via unknown.
        await addCommand.run?.({
          args: { service: name, dryRun: false, _: [] },
          cmd: addCommand,
          rawArgs: [name],
          data: undefined,
        } as unknown as Parameters<NonNullable<typeof addCommand.run>>[0]);
        succeeded.push(name);
      } catch (err) {
        failures.push({ name, message: (err as Error).message });
      }
    }

    // On partial failure, offer to roll back the successful adds so re-running
    // `stack apply` isn't blocked by SERVICE_ALREADY_ADDED errors. Default to
    // rolling back in non-TTY mode (CI-friendly) unless --noRollback is set.
    if (failures.length > 0 && succeeded.length > 0 && !args.noRollback) {
      const shouldRollback = process.stdout.isTTY
        ? await prompts.confirm({
            message: `Recipe partially applied (${succeeded.length} succeeded, ${failures.length} failed). Roll back the successful adds so you can re-run cleanly?`,
            initialValue: true,
          })
        : true;
      if (shouldRollback && !prompts.isCancel(shouldRollback)) {
        await rollbackServices(succeeded);
      } else {
        console.log(
          colors.dim(
            "  Keeping partial state. Run `stack doctor --fix` or `stack remove <name>` to clean up.",
          ),
        );
      }
    }

    // Phantom-wire only runs when at least one provider made it through — no
    // point creating rotation envelopes for services that aren't in the config.
    if (succeeded.length > 0) {
      try {
        const wire = await wirePhantomForRecipe(recipe, { noWire: Boolean(args.noWire) });
        if (!args.noWire) {
          console.log();
          console.log(
            `  ${colors.dim("envelopes")} ${wire.envelopes.length} · ${colors.dim("webhooks")} ${wire.webhooks.length}${
              wire.skipped.length > 0 ? ` · ${colors.yellow(`skipped ${wire.skipped.length}`)}` : ""
            }`,
          );
          if (wire.skipped.length > 0) {
            console.log(colors.dim(`  (phantom-wire skipped: ${wire.skipped.join(", ")})`));
          }
        }
      } catch (err) {
        console.log(colors.yellow(`  ⚠ phantom-wire failed: ${(err as Error).message}`));
      }
    }

    // Verify with doctor — informational; a failing doctor doesn't fail apply.
    try {
      console.log();
      console.log(colors.dim("  › stack doctor"));
      await doctorCommand.run?.({
        args: { fix: false, all: false, json: false, _: [] },
        cmd: doctorCommand,
        rawArgs: [],
        data: undefined,
      } as unknown as Parameters<NonNullable<typeof doctorCommand.run>>[0]);
    } catch {
      /* doctor surfaces its own errors */
    }

    if (failures.length > 0) {
      outroError(
        `Some providers failed: ${failures.map((f) => `${f.name}: ${f.message}`).join("; ")}`,
      );
      return;
    }
    outro(`${colors.green("✓")} ${recipe.id} applied.`);
  },
});

/**
 * Undo a partial apply. Reads the config, deletes each named service's secrets
 * + MCP entry, and rewrites the config without them. Best-effort: a failure
 * removing one service should not block the others.
 */
async function rollbackServices(names: string[]): Promise<void> {
  if (names.length === 0) return;
  console.log();
  console.log(colors.dim(`  rolling back ${names.length} partial add(s)…`));
  try {
    const config = await readConfig();
    for (const name of names) {
      const entry = config.services[name];
      if (!entry) continue;
      for (const secret of entry.secrets) {
        try {
          await removeSecret(secret);
        } catch {
          /* secret may already be gone; keep going */
        }
      }
      if (entry.mcp) {
        try {
          await removeMcpEntry(entry.mcp);
        } catch {
          /* keep going */
        }
      }
      delete config.services[name];
    }
    await writeConfig(config);
    console.log(colors.dim("  rollback complete — re-run `stack apply` to retry."));
  } catch (err) {
    console.log(colors.yellow(`  ⚠ rollback failed: ${(err as Error).message}`));
  }
}

async function pickRecipe(id?: string): Promise<Recipe | null> {
  if (id) {
    try {
      return await readRecipe(id);
    } catch (err) {
      outroError((err as Error).message);
      return null;
    }
  }

  const all = await listRecipes();
  if (all.length === 0) {
    outroError(
      "No recipes in .stack/recipes. Run `stack recommend` first, or ask Claude to synthesize one.",
    );
    return null;
  }

  if (!process.stdout.isTTY) {
    outroError(`No recipe id given. Available: ${all.map((r) => r.id).join(", ")}.`);
    return null;
  }

  const picked = await prompts.select({
    message: "Which recipe to apply?",
    options: all.map((r) => ({
      value: r.id,
      label: `${colors.bold(r.id)} ${colors.dim(`· ${r.providers.length} providers`)}`,
      hint: r.query.slice(0, 60),
    })),
  });
  if (prompts.isCancel(picked)) {
    outroError("Cancelled.");
    return null;
  }
  return all.find((r) => r.id === String(picked)) ?? null;
}
