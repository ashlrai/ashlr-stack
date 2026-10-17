import { type StackConfig, getProvider, readConfig } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, outro } from "../ui.ts";

/**
 * Stable machine shape for `stack deps --json`. Fields may be added but
 * existing ones must not change meaning. Secret *names* only, never values.
 * Services whose provider is not in the registry are listed in `unresolved`
 * (the human graph omits them) but still count toward `totals`.
 */
export interface DepsReport {
  schema: "ashlr.stack.deps/v1";
  project_id: string | null;
  template: string | null;
  categories: Array<{
    category: string;
    services: Array<{
      name: string;
      provider: string;
      displayName: string;
      secrets: string[];
      mcp: string | null;
    }>;
  }>;
  unresolved: string[];
  totals: { services: number; secrets: number; mcp: number };
}

export async function buildDepsReport(config: StackConfig): Promise<DepsReport> {
  const services = Object.entries(config.services);
  const byCategory = new Map<string, DepsReport["categories"][number]["services"]>();
  const unresolved: string[] = [];
  for (const [name, entry] of services) {
    try {
      const p = await getProvider(entry.provider);
      const list = byCategory.get(p.category) ?? [];
      list.push({
        name,
        provider: entry.provider,
        displayName: p.displayName,
        secrets: [...(entry.secrets ?? [])],
        mcp: entry.mcp ?? null,
      });
      byCategory.set(p.category, list);
    } catch {
      unresolved.push(name);
    }
  }
  return {
    schema: "ashlr.stack.deps/v1",
    project_id: config.stack.project_id ?? null,
    template: config.stack.template ?? null,
    categories: [...byCategory.keys()]
      .sort()
      .map((category) => ({ category, services: byCategory.get(category) ?? [] })),
    unresolved,
    totals: {
      services: services.length,
      secrets: services.reduce((acc, [, e]) => acc + (e.secrets?.length ?? 0), 0),
      mcp: services.filter(([, e]) => e.mcp).length,
    },
  };
}

/**
 * `stack deps` — render an ASCII dependency graph of the services Stack has
 * wired up for the current project, grouped by category and annotated with
 * their secret slots. Good for onboarding a new developer ("here's what the
 * stack looks like") and for sanity-checking templates.
 */
export const depsCommand = defineCommand({
  meta: {
    name: "deps",
    description: "Show the service dependency graph for this stack.",
  },
  args: {
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON (schema ashlr.stack.deps/v1).",
    },
  },
  async run({ args }) {
    if (args.json) {
      let config: StackConfig;
      try {
        config = await readConfig();
      } catch (err) {
        process.stdout.write(
          `${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n`,
        );
        process.exit(1);
      }
      process.stdout.write(`${JSON.stringify(await buildDepsReport(config), null, 2)}\n`);
      return;
    }

    intro("stack deps");
    const config = await readConfig();
    const services = Object.entries(config.services);
    if (services.length === 0) {
      outro(colors.dim("No services yet."));
      return;
    }

    // Group by category.
    const byCategory: Record<
      string,
      Array<{ name: string; displayName: string; secrets: string[]; mcp?: string }>
    > = {};
    for (const [name, entry] of services) {
      try {
        const p = await getProvider(entry.provider);
        if (!byCategory[p.category]) byCategory[p.category] = [];
        byCategory[p.category].push({
          name,
          displayName: p.displayName,
          secrets: entry.secrets,
          mcp: entry.mcp,
        });
      } catch {
        /* skip */
      }
    }

    console.log();
    console.log(`  ${colors.bold(config.stack.project_id)}`);
    if (config.stack.template) {
      console.log(`  ${colors.dim("template:")} ${config.stack.template}`);
    }
    console.log();

    const categories = Object.keys(byCategory).sort();
    for (let i = 0; i < categories.length; i += 1) {
      const cat = categories[i];
      const isLast = i === categories.length - 1;
      const branch = isLast ? "└──" : "├──";
      const cont = isLast ? "   " : "│  ";
      console.log(`  ${branch} ${colors.bold(cat)}`);
      const items = byCategory[cat];
      for (let j = 0; j < items.length; j += 1) {
        const item = items[j];
        const subLast = j === items.length - 1;
        const subBranch = subLast ? "└──" : "├──";
        const subCont = subLast ? "   " : "│  ";
        const mcpTag = item.mcp ? colors.cyan(` mcp:${item.mcp}`) : "";
        console.log(`  ${cont} ${subBranch} ${colors.green("●")} ${item.displayName}${mcpTag}`);
        for (const secret of item.secrets) {
          console.log(`  ${cont} ${subCont} ${colors.dim("·")} ${colors.dim(secret)}`);
        }
      }
      if (!isLast) console.log("  │");
    }
    console.log();

    const totalSecrets = services.reduce((acc, [, e]) => acc + e.secrets.length, 0);
    const totalMcps = services.filter(([, e]) => e.mcp).length;
    outro(
      colors.dim(
        `${services.length} services · ${totalSecrets} secrets · ${totalMcps} MCP server(s)`,
      ),
    );
  },
});
