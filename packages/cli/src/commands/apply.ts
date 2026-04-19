import {
  type Recipe,
  hasConfig,
  listRecipes,
  readRecipe,
  wirePhantomForRecipe,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro, outroError, prompts } from "../ui.ts";
import { addCommand } from "./add.ts";
import { doctorCommand } from "./doctor.ts";

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
  },
  async run({ args }) {
    if (!hasConfig()) {
      intro("stack apply");
      outroError("No .stack.toml found. Run `stack init` first.");
      return;
    }

    intro(`stack apply${args.noWire ? colors.dim(" (no-wire)") : ""}`);

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
    const failures: string[] = [];
    for (const { name } of recipe.providers) {
      try {
        console.log(colors.dim(`  › stack add ${name}`));
        // citty's CommandContext type requires every declared arg key; we only
        // set the ones addCommand actually reads, so double-cast via unknown.
        await addCommand.run?.({
          args: { service: name, dryRun: false, _: [] },
          cmd: addCommand,
          rawArgs: [name],
          data: undefined,
        } as unknown as Parameters<NonNullable<typeof addCommand.run>>[0]);
      } catch (err) {
        failures.push(`${name}: ${(err as Error).message}`);
      }
    }

    // Phantom-wire runs after adds — envelopes for rotation + webhook stubs.
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
      outroError(`Some providers failed: ${failures.join("; ")}`);
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
