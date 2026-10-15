import {
  type StackConfig,
  hasConfig,
  isPhantomInstalled,
  listSecrets,
  readConfig,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { colors } from "../ui.ts";

/**
 * Stable machine shape for `stack status --json`. Consumers (Phantom's
 * `ashlr stack status`, onboard, MCP clients) parse `services[].name`, so
 * fields may be added but existing ones must not change meaning.
 * Secret *names* only — never values.
 */
export interface StatusReport {
  schema: "ashlr.stack.status/v1";
  config: {
    present: boolean;
    project_id: string | null;
    template: string | null;
  };
  phantom: {
    installed: boolean;
    /** Names in the vault, or null when the vault could not be read. */
    secret_count: number | null;
  };
  services: Array<{
    name: string;
    provider: string;
    resource_id: string | null;
    region: string | null;
    secrets: string[];
    mcp: string | null;
  }>;
}

export function buildStatusReport(input: {
  config: StackConfig | undefined;
  phantomInstalled: boolean;
  secretCount: number | null;
}): StatusReport {
  const { config } = input;
  return {
    schema: "ashlr.stack.status/v1",
    config: {
      present: config !== undefined,
      project_id: config?.stack.project_id ?? null,
      template: config?.stack.template ?? null,
    },
    phantom: {
      installed: input.phantomInstalled,
      secret_count: input.phantomInstalled ? input.secretCount : null,
    },
    services: Object.entries(config?.services ?? {}).map(([name, entry]) => ({
      name,
      provider: entry.provider,
      resource_id: entry.resource_id ?? null,
      region: entry.region ?? null,
      secrets: [...(entry.secrets ?? [])],
      mcp: entry.mcp ?? null,
    })),
  };
}

export const statusCommand = defineCommand({
  meta: { name: "status", description: "Show stack health at a glance." },
  args: {
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON (services, config, phantom).",
    },
  },
  async run({ args }) {
    const hasStack = hasConfig();
    const phantomOk = await isPhantomInstalled();

    if (args.json) {
      let config: StackConfig | undefined;
      try {
        config = hasStack ? await readConfig() : undefined;
      } catch (err) {
        process.stdout.write(
          `${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n`,
        );
        process.exit(1);
      }
      const secretCount = phantomOk
        ? await listSecrets()
            .then((keys) => keys.length)
            .catch(() => null)
        : null;
      const report = buildStatusReport({ config, phantomInstalled: phantomOk, secretCount });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    const config = hasStack ? await readConfig() : undefined;
    const vaultKeys = phantomOk ? await listSecrets().catch(() => []) : [];

    console.log();
    console.log(colors.bold("  Ashlr Stack"));
    console.log();
    console.log(
      `  ${statusDot(hasStack)} .stack.toml       ${hasStack ? colors.dim(config?.stack.project_id) : colors.dim("missing — run `stack init`")}`,
    );
    console.log(
      `  ${statusDot(phantomOk)} phantom           ${phantomOk ? colors.dim(`${vaultKeys.length} secrets in vault`) : colors.dim("not installed")}`,
    );
    console.log(
      `  ${statusDot(hasStack && Object.keys(config?.services ?? {}).length > 0)} services          ${colors.dim(`${Object.keys(config?.services ?? {}).length} configured`)}`,
    );
    console.log();
    if (config) {
      for (const [name, entry] of Object.entries(config.services)) {
        console.log(
          `    ${colors.cyan("·")} ${name.padEnd(14)} ${colors.dim(entry.resource_id ?? "-")}`,
        );
      }
      console.log();
    }
  },
});

function statusDot(ok: boolean): string {
  return ok ? colors.green("●") : colors.red("●");
}
