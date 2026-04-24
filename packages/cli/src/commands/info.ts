import {
  type ProviderContext,
  getProvider,
  isPhantomInstalled,
  listSecrets,
  readConfig,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors, intro, logEvent, outro, outroError, prompts } from "../ui.ts";

/**
 * `stack info <service>` — deep-dive on a configured service. Prints its
 * provider, resource id, region, secret slots (with vault presence), MCP
 * wiring, dashboard URL, and runs a fresh healthcheck.
 */
export const infoCommand = defineCommand({
  meta: {
    name: "info",
    description: "Show everything Stack knows about a configured service.",
  },
  args: {
    service: { type: "positional", required: true, description: "Service name." },
  },
  async run({ args }) {
    intro(`stack info ${args.service}`);
    const config = await readConfig();
    const entry = config.services[String(args.service)];
    if (!entry) {
      outroError(`${args.service} is not in this stack. Run \`stack list\`.`);
      return;
    }

    const provider = await getProvider(entry.provider);
    const vaultKeys = (await isPhantomInstalled()) ? new Set(await listSecrets()) : new Set();

    console.log();
    console.log(`  ${colors.bold(provider.displayName)}  ${colors.dim(provider.category)}`);
    console.log(`    ${colors.dim("resource:")} ${entry.resource_id ?? "(not provisioned)"}`);
    if (entry.region) console.log(`    ${colors.dim("region:")}   ${entry.region}`);
    console.log(`    ${colors.dim("auth:")}     ${provider.authKind}`);
    console.log(
      `    ${colors.dim("created:")}  ${entry.created_at}${entry.created_by ? colors.dim(` by ${entry.created_by}`) : ""}`,
    );
    if (provider.docs) console.log(`    ${colors.dim("docs:")}     ${provider.docs}`);
    const dashboard = provider.dashboardUrl?.(entry);
    if (dashboard) console.log(`    ${colors.dim("dash:")}     ${dashboard}`);
    if (entry.mcp) console.log(`    ${colors.dim("mcp:")}      ${entry.mcp}`);
    if (entry.meta && Object.keys(entry.meta).length > 0) {
      console.log(`    ${colors.dim("meta:")}     ${JSON.stringify(entry.meta)}`);
    }
    console.log();

    console.log(`  ${colors.bold("secrets")}`);
    for (const slot of entry.secrets) {
      const present = vaultKeys.has(slot);
      const dot = present ? colors.green("●") : colors.red("○");
      const tag = present ? colors.dim("in vault") : colors.red("missing");
      console.log(`    ${dot} ${slot.padEnd(30)} ${tag}`);
    }
    console.log();

    if (provider.healthcheck) {
      const ctx: ProviderContext = {
        cwd: process.cwd(),
        interactive: false,
        log: logEvent,
      };
      const spinner = prompts.spinner();
      spinner.start("Running healthcheck…");
      try {
        const status = await provider.healthcheck(ctx, entry);
        if (status.kind === "ok") {
          spinner.stop(
            `${colors.green("●")} healthy${status.latencyMs ? colors.dim(` (${status.latencyMs}ms)`) : ""}`,
          );
        } else if (status.kind === "warn") {
          spinner.stop(`${colors.yellow("●")} warning: ${status.detail}`);
        } else {
          spinner.stop(`${colors.red("●")} error: ${status.detail}`);
        }
      } catch (err) {
        spinner.stop(`${colors.red("●")} healthcheck threw: ${(err as Error).message}`);
      }
    }
    outro("");
  },
});
