import { type StackConfig, readConfig } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors } from "../ui.ts";

/**
 * Stable machine shape for `stack list --json`. Fields may be added but
 * existing ones must not change meaning. Secret *names* only, never values.
 */
export interface ListReport {
  schema: "ashlr.stack.list/v1";
  project_id: string | null;
  template: string | null;
  services: Array<{
    name: string;
    provider: string;
    resource_id: string | null;
    region: string | null;
    secrets: string[];
    mcp: string | null;
  }>;
}

export function buildListReport(config: StackConfig): ListReport {
  return {
    schema: "ashlr.stack.list/v1",
    project_id: config.stack.project_id ?? null,
    template: config.stack.template ?? null,
    services: Object.entries(config.services).map(([name, entry]) => ({
      name,
      provider: entry.provider,
      resource_id: entry.resource_id ?? null,
      region: entry.region ?? null,
      secrets: [...(entry.secrets ?? [])],
      mcp: entry.mcp ?? null,
    })),
  };
}

export const listCommand = defineCommand({
  meta: { name: "list", description: "List services configured in this stack." },
  args: {
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON (schema ashlr.stack.list/v1).",
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
      process.stdout.write(`${JSON.stringify(buildListReport(config), null, 2)}\n`);
      return;
    }

    const config = await readConfig();
    const entries = Object.entries(config.services);
    if (entries.length === 0) {
      console.log(colors.dim("No services yet. Try `stack add supabase`."));
      return;
    }
    console.log();
    console.log(
      colors.bold(`  ${config.stack.project_id}  `) + colors.dim(`(${entries.length} services)`),
    );
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
