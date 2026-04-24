import { getProvider, listProviderNames } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro } from "../ui.ts";

export const providersCommand = defineCommand({
  meta: { name: "providers", description: "List every curated provider Stack can wire up." },
  async run() {
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
