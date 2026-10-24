import { PROVIDER_CATEGORIES, getProvider, listProviderNames } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outroError } from "../ui.ts";

interface ProviderRow {
  name: string;
  displayName: string;
  category: string;
  authKind: string;
  docs: string | null;
}

/**
 * Stable machine shape for `stack providers --json`. Fields may be added but
 * existing ones must not change meaning. `total` counts registry names, so a
 * provider that failed to load is listed in `unavailable` instead of `providers`.
 * With `--category`, `category` names it and `total` counts the providers in
 * that category; `unavailable` still lists every load failure, since a
 * provider that failed to load has no known category.
 */
export interface ProvidersReport {
  schema: "ashlr.stack.providers/v1";
  category: string | null;
  total: number;
  providers: ProviderRow[];
  unavailable: string[];
}

/** Provider modules name their category in lower case ("database"). */
const CATEGORIES = PROVIDER_CATEGORIES.map((c) => c.toLowerCase());

/** The provider category matching `input` in any case, or null. */
export function resolveCategory(input: string): string | null {
  const wanted = input.trim().toLowerCase();
  return CATEGORIES.find((c) => c === wanted) ?? null;
}

export function unknownCategoryMessage(input: string): string {
  return `Unknown category "${input}". Use one of: ${CATEGORIES.join(", ")}`;
}

export async function buildProvidersReport(category?: string): Promise<ProvidersReport> {
  const names = listProviderNames();
  const providers: ProviderRow[] = [];
  const unavailable: string[] = [];
  for (const name of names) {
    try {
      const p = await getProvider(name);
      if (category && p.category !== category) continue;
      providers.push({
        name: p.name,
        displayName: p.displayName,
        category: p.category,
        authKind: p.authKind,
        docs: p.docs ?? null,
      });
    } catch {
      unavailable.push(name);
    }
  }
  return {
    schema: "ashlr.stack.providers/v1",
    category: category ?? null,
    total: category ? providers.length : names.length,
    providers,
    unavailable,
  };
}

export const providersCommand = defineCommand({
  meta: { name: "providers", description: "List every curated provider Stack can wire up." },
  args: {
    category: {
      type: "string",
      description: `Only this category, any case (${CATEGORIES.join(", ")}).`,
      required: false,
    },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON (schema ashlr.stack.providers/v1).",
    },
  },
  async run({ args }) {
    let category: string | undefined;
    if (args.category !== undefined) {
      const match = resolveCategory(String(args.category));
      if (!match) {
        const message = unknownCategoryMessage(String(args.category));
        if (args.json) {
          console.log(JSON.stringify({ error: message }));
          process.exitCode = 1;
          return;
        }
        outroError(message);
        return;
      }
      category = match;
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(await buildProvidersReport(category), null, 2)}\n`);
      return;
    }

    intro("stack providers");
    const names = listProviderNames();
    const byCategory: Record<
      string,
      Array<{ name: string; displayName: string; auth: string }>
    > = {};
    for (const name of names) {
      try {
        const p = await getProvider(name);
        if (category && p.category !== category) continue;
        if (!byCategory[p.category]) byCategory[p.category] = [];
        byCategory[p.category].push({
          name: p.name,
          displayName: p.displayName,
          auth: p.authKind,
        });
      } catch {
        /* ignore load failures — the registry is authoritative */
      }
    }

    const categories = Object.keys(byCategory).sort();
    console.log();
    for (const cat of categories) {
      console.log(`  ${colors.bold(cat)}`);
      for (const p of byCategory[cat]) {
        console.log(
          `    ${colors.cyan("·")} ${p.name.padEnd(12)} ${colors.dim(`(${p.auth})`)}  ${p.displayName}`,
        );
      }
      console.log();
    }
    const shown = category ? (byCategory[category]?.length ?? 0) : names.length;
    const scope = category ? `in ${category}` : "total";
    console.log(colors.dim(`  ${shown} providers ${scope}. Add one with: stack add <name>`));
    console.log();
  },
});
