import {
  type Recipe,
  hasConfig,
  listRecipes,
  readRecipe,
  wirePhantomForRecipe,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { requirePhantom } from "../lib/phantom-preflight.ts";
import { provisionProviders } from "../lib/provision-loop.ts";
import { colors, intro, outro, outroError, prompts } from "../ui.ts";
import { doctorCommand } from "./doctor.ts";
import { initCommand } from "./init.ts";

/**
 * `stack apply [recipe-id]` — replay a frozen Recipe through the add pipeline,
 * then report which declared secrets are in the Phantom vault (and which are
 * missing) and drop webhook stubs. The real values come from `stack add`;
 * apply never writes placeholders to the vault.
 *
 * recommendation → TOML → `apply` → provisioned stack.
 */
export const applyCommand = defineCommand({
  meta: {
    name: "apply",
    description:
      "Apply a saved recipe: provision each provider, check its secrets in Phantom, and add webhook stubs.",
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
      description: "Skip the Phantom vault check and webhook stubs.",
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
          args: {
            noInteractive: true,
            force: false,
            noProvision: true,
            dryRun: false,
            noRollback: false,
            _: [],
          },
          cmd: initCommand,
          rawArgs: ["--noInteractive", "--noProvision"],
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

    await requirePhantom();

    console.log();
    console.log(`  ${colors.bold("recipe")}   ${recipe.id}`);
    console.log(`  ${colors.dim("query")}    ${recipe.query}`);
    console.log(`  ${colors.dim("providers")} ${recipe.providers.map((p) => p.name).join(", ")}`);
    console.log();

    // Re-run addCommand for each provider via the shared provision loop.
    // We intentionally do NOT parallelize: some providers (e.g. Vercel) need
    // cwd state written by earlier steps and interactive prompts don't
    // interleave cleanly.
    const { succeeded, failures } = await provisionProviders(recipe.providers, {
      rollback: !args.noRollback,
    });

    // Phantom-wire only runs when at least one provider made it through — no
    // point checking secrets for services that aren't in the config.
    if (succeeded.length > 0) {
      try {
        const wire = await wirePhantomForRecipe(recipe, { noWire: Boolean(args.noWire) });
        if (!args.noWire) {
          console.log();
          console.log(
            `  ${colors.dim("secrets in vault")} ${wire.present.length} · ${colors.dim("missing")} ${wire.missing.length} · ${colors.dim("webhooks")} ${wire.webhooks.length}${
              wire.skipped.length > 0 ? ` · ${colors.yellow(`skipped ${wire.skipped.length}`)}` : ""
            }`,
          );
          if (wire.missing.length > 0) {
            console.log(
              colors.yellow(
                `  (not in Phantom: ${wire.missing.map((m) => m.split(":")[1]).join(", ")} — store with \`phantom add <NAME>\`)`,
              ),
            );
          }
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
