import {
  type HealthStatus,
  type ProviderContext,
  type ServiceEntry,
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
    json: {
      type: "boolean",
      default: false,
      description: "Emit machine-readable JSON (schema ashlr.stack.info/v1, secret names only).",
    },
  },
  async run({ args }) {
    if (args.json) {
      await runInfoJson(String(args.service));
      return;
    }
    intro(`stack info ${args.service}`);
    const config = await readConfig();
    const entry = config.services[String(args.service)];
    if (!entry) {
      outroError(`${args.service} is not in this stack. Run \`stack list\`.`);
      return;
    }

    const provider = await getProvider(entry.provider);
    // null = vault unreadable (Phantom missing, no .phantom.toml, timeout):
    // show slot presence as unknown rather than reporting everything missing.
    const vaultKeys = await readVaultNames();

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
      if (!vaultKeys) {
        console.log(`    ${colors.yellow("?")} ${slot.padEnd(30)} ${colors.yellow("unknown")}`);
        continue;
      }
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

/** Vault secret names, or null when the vault cannot be read. */
async function readVaultNames(): Promise<Set<string> | null> {
  if (!(await isPhantomInstalled())) return null;
  try {
    return new Set(await listSecrets());
  } catch {
    return null;
  }
}

/**
 * `stack info <service> --json`: one JSON object on stdout, no banner. A
 * missing project or service prints `{"error": ...}` and exits 1, like
 * `stack doctor --json`. `in_vault` is null when the vault is unreadable.
 */
async function runInfoJson(service: string): Promise<void> {
  const fail = (error: string) => {
    process.stdout.write(`${JSON.stringify({ error })}\n`);
    process.exitCode = 1;
  };
  let entry: ServiceEntry | undefined;
  try {
    entry = (await readConfig()).services[service];
  } catch (err) {
    fail((err as Error).message);
    return;
  }
  if (!entry) {
    fail(`${service} is not in this stack. Run \`stack list\`.`);
    return;
  }
  const provider = await getProvider(entry.provider);
  const vaultKeys = await readVaultNames();
  let health: HealthStatus | null = null;
  if (provider.healthcheck) {
    const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
    try {
      health = await provider.healthcheck(ctx, entry);
    } catch (err) {
      health = { kind: "error", detail: `healthcheck threw: ${(err as Error).message}` };
    }
  }
  const report = {
    schema: "ashlr.stack.info/v1",
    service,
    provider: entry.provider,
    display_name: provider.displayName,
    category: provider.category,
    auth_kind: provider.authKind,
    resource_id: entry.resource_id ?? null,
    region: entry.region ?? null,
    created_at: entry.created_at ?? null,
    created_by: entry.created_by ?? null,
    docs: provider.docs || null,
    dashboard: provider.dashboardUrl?.(entry) || null,
    mcp: entry.mcp ?? null,
    meta: entry.meta ?? {},
    secrets: entry.secrets.map((name) => ({
      name,
      in_vault: vaultKeys ? vaultKeys.has(name) : null,
    })),
    health,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
