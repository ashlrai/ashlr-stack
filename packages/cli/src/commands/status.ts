import {
  type StackConfig,
  countSecrets,
  hasConfig,
  isPhantomInstalled,
  readConfig,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import {
  STATUS_CHECK_CONCURRENCY,
  STATUS_CHECK_TIMEOUT_MS,
  type StatusCheck,
  type StatusCheckResult,
  type StatusCheckRunOptions,
  runStatusChecks,
} from "../lib/status-checks.ts";
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

/** Probes `stack status` can swap in tests. Production uses the real filesystem and Phantom. */
export interface StatusDeps {
  hasConfig: () => boolean;
  readConfig: () => Promise<StackConfig>;
  isPhantomInstalled: (timeoutMs: number) => Promise<boolean>;
  countSecrets: (timeoutMs: number) => Promise<number | null>;
}

export function defaultStatusDeps(): StatusDeps {
  return {
    hasConfig: () => hasConfig(),
    readConfig: () => readConfig(),
    isPhantomInstalled: (timeoutMs) => isPhantomInstalled({ timeoutMs }),
    // The version probe runs as its own check, so the vault list overlaps it.
    countSecrets: (timeoutMs) => countSecrets(undefined, { skipInstallCheck: true, timeoutMs }),
  };
}

type ProbeValue =
  | { kind: "config"; config: StackConfig | undefined }
  | { kind: "phantom"; installed: boolean }
  | { kind: "secrets"; count: number | null };

export interface LoadedStatus {
  hasStack: boolean;
  config: StackConfig | undefined;
  phantomInstalled: boolean;
  /** Null when Phantom is missing or the vault could not be read. */
  secretCount: number | null;
}

/**
 * Config, Phantom, and the vault count are independent. They run together.
 * A config failure still throws the original error. A Phantom or vault failure
 * becomes the same installed/count values the sequential command used.
 */
export async function loadStatus(
  deps: StatusDeps = defaultStatusDeps(),
  opts: StatusCheckRunOptions = {
    timeoutMs: STATUS_CHECK_TIMEOUT_MS,
    concurrency: STATUS_CHECK_CONCURRENCY,
  },
): Promise<LoadedStatus> {
  const hasStack = deps.hasConfig();
  const checks: Array<StatusCheck<ProbeValue>> = [
    {
      name: "config",
      run: async () => ({
        kind: "config",
        config: hasStack ? await deps.readConfig() : undefined,
      }),
    },
    {
      name: "phantom",
      run: async () => ({
        kind: "phantom",
        installed: await deps.isPhantomInstalled(opts.timeoutMs),
      }),
    },
    {
      name: "secrets",
      run: async () => ({ kind: "secrets", count: await deps.countSecrets(opts.timeoutMs) }),
    },
  ];
  const [configResult, phantomResult, secretsResult] = await runStatusChecks(checks, opts);
  const phantomInstalled = phantomFrom(phantomResult);
  return {
    hasStack,
    config: configFrom(configResult),
    phantomInstalled,
    secretCount: secretCountFrom(secretsResult, phantomInstalled),
  };
}

function configFrom(result: StatusCheckResult<ProbeValue> | undefined): StackConfig | undefined {
  if (!result) throw new Error("status config check did not finish");
  if (result.state === "error" || result.state === "timeout") throw result.error;
  if (result.value.kind !== "config")
    throw new Error("status config check returned the wrong value");
  return result.value.config;
}

/** A thrown or timed out install probe matches `isPhantomInstalled` catching and returning false. */
function phantomFrom(result: StatusCheckResult<ProbeValue> | undefined): boolean {
  return (
    result?.state === "ok" && result.value.kind === "phantom" && result.value.installed === true
  );
}

/**
 * A thrown or timed out count matches `countSecrets` returning null.
 * The count is ignored when Phantom itself is not installed.
 */
function secretCountFrom(
  result: StatusCheckResult<ProbeValue> | undefined,
  phantomInstalled: boolean,
): number | null {
  if (!phantomInstalled) return null;
  if (!result || result.state !== "ok" || result.value.kind !== "secrets") return null;
  return result.value.count;
}

/** Human lines in the historical order. `console.log` prints each one. */
export function statusLines(loaded: LoadedStatus): string[] {
  const { hasStack, config, phantomInstalled } = loaded;
  const vaultCount = phantomInstalled ? (loaded.secretCount ?? 0) : 0;
  const lines = [
    "",
    colors.bold("  Ashlr Stack"),
    "",
    `  ${statusDot(hasStack)} .stack.toml       ${hasStack ? colors.dim(config?.stack.project_id) : colors.dim("missing — run `stack init`")}`,
    `  ${statusDot(phantomInstalled)} phantom           ${phantomInstalled ? colors.dim(`${vaultCount} secrets in vault`) : colors.dim("not installed")}`,
    `  ${statusDot(hasStack && Object.keys(config?.services ?? {}).length > 0)} services          ${colors.dim(`${Object.keys(config?.services ?? {}).length} configured`)}`,
    "",
  ];
  if (config) {
    for (const [name, entry] of Object.entries(config.services)) {
      lines.push(
        `    ${colors.cyan("·")} ${name.padEnd(14)} ${colors.dim(entry.resource_id ?? "-")}`,
      );
    }
    lines.push("");
  }
  return lines;
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
    let loaded: LoadedStatus;
    try {
      loaded = await loadStatus();
    } catch (err) {
      if (args.json) {
        process.stdout.write(
          `${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n`,
        );
        process.exit(1);
      }
      throw err;
    }

    if (args.json) {
      const report = buildStatusReport({
        config: loaded.config,
        phantomInstalled: loaded.phantomInstalled,
        secretCount: loaded.secretCount,
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    for (const line of statusLines(loaded)) console.log(line);
  },
});

function statusDot(ok: boolean): string {
  return ok ? colors.green("●") : colors.red("●");
}
