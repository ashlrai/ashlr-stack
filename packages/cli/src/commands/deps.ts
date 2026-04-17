import { defineCommand } from "citty";
import { getProvider, readConfig } from "@ashlr/stack-core";
import { colors, intro, outro } from "../ui.ts";

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
  async run() {
    intro("stack deps");
    const config = await readConfig();
    const services = Object.entries(config.services);
    if (services.length === 0) {
      outro(colors.dim("No services yet."));
      return;
    }

    // Group by category.
    const byCategory: Record<string, Array<{ name: string; displayName: string; secrets: string[]; mcp?: string }>> = {};
    for (const [name, entry] of services) {
      try {
        const p = await getProvider(entry.provider);
        (byCategory[p.category] ??= []).push({
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
      if (!isLast) console.log(`  │`);
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
