import { defineCommand } from "citty";
import { readConfig } from "@ashlr/stack-core";
import { colors } from "../ui.ts";

export const listCommand = defineCommand({
  meta: { name: "list", description: "List services configured in this stack." },
  async run() {
    const config = await readConfig();
    const entries = Object.entries(config.services);
    if (entries.length === 0) {
      console.log(colors.dim("No services yet. Try `stack add supabase`."));
      return;
    }
    console.log();
    console.log(colors.bold(`  ${config.stack.project_id}  `) + colors.dim(`(${entries.length} services)`));
    console.log();
    for (const [name, entry] of entries) {
      const mcp = entry.mcp ? colors.cyan(` mcp:${entry.mcp}`) : "";
      const region = entry.region ? colors.dim(` @${entry.region}`) : "";
      console.log(`  ${colors.green("●")} ${colors.bold(name)}${region}${mcp}`);
      console.log(
        `    ${colors.dim("resource:")} ${entry.resource_id ?? "-"}   ${colors.dim("secrets:")} ${entry.secrets.join(", ") || "-"}`,
      );
    }
    console.log();
  },
});
