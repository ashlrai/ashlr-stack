import { getProvider, listProviderNames } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro } from "../ui.ts";

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
 */
export interface ProvidersReport {
  schema: "ashlr.stack.providers/v1";
  total: number;
  providers: ProviderRow[];
  unavailable: string[];
}

export async function buildProvidersReport(): Promise<ProvidersReport> {
  const names = listProviderNames();
  const providers: ProviderRow[] = [];
  const unavailable: string[] = [];
  for (const name of names) {
    try {
      const p = await getProvider(name);
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
  return { schema: "ashlr.stack.providers/v1", total: names.length, providers, unavailable };
}

export const providersCommand = defineCommand({
  meta: { name: "providers", description: "List every curated provider Stack can wire up." },
  args: {
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON (schema ashlr.stack.providers/v1).",
    },
  },
  async run({ args }) {
    if (args.json) {
      process.stdout.write(`${JSON.stringify(await buildProvidersReport(), null, 2)}\n`);
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
    console.log(colors.dim(`  ${names.length} providers total. Add one with: stack add <name>`));
    console.log();
  },
});
