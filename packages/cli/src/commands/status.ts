import {
  PhantomTimeoutError,
  type StackConfig,
  hasConfig,
  listSecrets,
  probePhantomInstalled,
  readConfig,
} from "@ashlr/stack-core";
import { defineCommand } from "citty";
import {
  STATUS_CHECK_CONCURRENCY,
  STATUS_CHECK_TIMEOUT_MS,
  type StatusCheck,
  type StatusCheckResult,
  type StatusCheckRunOptions,
  StatusCheckTimeoutError,
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
    /** Present only when secret_count is null because the vault read timed out or failed. */
    secret_count_error?: "timeout" | "error";
    /** Present only when `phantom --version` timed out, so installed is unknown. */
    installed_error?: "timeout";
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
  secretCountError?: "timeout" | "error";
  installedError?: "timeout";
}): StatusReport {
  const { config } = input;
  const secretCount = input.phantomInstalled ? input.secretCount : null;
  return {
    schema: "ashlr.stack.status/v1",
    config: {
      present: config !== undefined,
      project_id: config?.stack.project_id ?? null,
      template: config?.stack.template ?? null,
    },
    phantom: {
      installed: input.phantomInstalled,
      secret_count: secretCount,
      ...(secretCount === null && input.phantomInstalled && input.secretCountError
        ? { secret_count_error: input.secretCountError }
        : {}),
      ...(input.installedError ? { installed_error: input.installedError } : {}),
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
  /** `"timeout"` means installed is unknown, not missing. */
  isPhantomInstalled: (timeoutMs: number) => Promise<boolean | "timeout">;
  /** Throws when the vault cannot be read; null also means unreadable. */
  countSecrets: (timeoutMs: number) => Promise<number | null>;
}

export function defaultStatusDeps(): StatusDeps {
  return {
    hasConfig: () => hasConfig(),
    readConfig: () => readConfig(),
    isPhantomInstalled: async (timeoutMs) => {
      const state = await probePhantomInstalled({ timeoutMs });
      return state === "timeout" ? "timeout" : state === "installed";
    },
    // The version probe runs as its own check, so the vault list overlaps it.
    // Errors propagate so status can tell a timeout from a failed read.
    countSecrets: async (timeoutMs) =>
      (await listSecrets(undefined, { skipInstallCheck: true, timeoutMs })).length,
  };
}

type ProbeValue =
  | { kind: "phantom"; installed: boolean | "timeout" }
  | { kind: "secrets"; count: number | null };

export interface LoadedStatus {
  hasStack: boolean;
  config: StackConfig | undefined;
  phantomInstalled: boolean;
  /** Null when Phantom is missing or the vault could not be read. */
  secretCount: number | null;
  /** Why secretCount is null while Phantom is installed. */
  secretCountError?: "timeout" | "error";
  /** Set when the version probe timed out and the vault list did not prove Phantom is there. */
  installedError?: "timeout";
}

/**
 * Config, Phantom, and the vault count are independent. They run together
 * (three at once at most: config plus two capped probes). The config read has
 * no timeout, as on main, and a config failure still throws the original
 * error. A Phantom or vault failure becomes the same installed/count values
 * the sequential command used, plus a marker saying whether it timed out.
 */
export async function loadStatus(
  deps: StatusDeps = defaultStatusDeps(),
  opts: StatusCheckRunOptions = {
    timeoutMs: STATUS_CHECK_TIMEOUT_MS,
    concurrency: STATUS_CHECK_CONCURRENCY,
  },
): Promise<LoadedStatus> {
  const hasStack = deps.hasConfig();
  const configPromise = hasStack ? deps.readConfig() : Promise.resolve(undefined);
  // Avoid an unhandled rejection while the probes run; the await below rethrows.
  configPromise.catch(() => {});
  const probeOpts = { ...opts, concurrency: Math.max(1, opts.concurrency - 1) };
  const checks: Array<StatusCheck<ProbeValue>> = [
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
  const [probes, config] = await Promise.all([runStatusChecks(checks, probeOpts), configPromise]);
  const [phantomResult, secretsResult] = probes;
  const installState = phantomFrom(phantomResult);
  const secrets = secretsFrom(secretsResult);
  // A vault list that answered proves Phantom is installed even if --version was slow.
  const phantomInstalled =
    installState === true || (installState === "timeout" && secrets.count !== null);
  const loaded: LoadedStatus = {
    hasStack,
    config,
    phantomInstalled,
    secretCount: phantomInstalled ? secrets.count : null,
  };
  if (installState === "timeout" && !phantomInstalled) loaded.installedError = "timeout";
  if (phantomInstalled && secrets.count === null && secrets.error) {
    loaded.secretCountError = secrets.error;
  }
  return loaded;
}

/** A thrown install probe matches `isPhantomInstalled` returning false. A timeout stays unknown. */
function phantomFrom(result: StatusCheckResult<ProbeValue> | undefined): boolean | "timeout" {
  if (result?.state === "timeout") return "timeout";
  if (result?.state !== "ok" || result.value.kind !== "phantom") return false;
  return result.value.installed;
}

function isTimeout(err: unknown): boolean {
  return err instanceof StatusCheckTimeoutError || err instanceof PhantomTimeoutError;
}

/** A thrown or timed out count is null, as `countSecrets` returned, with the cause kept. */
function secretsFrom(result: StatusCheckResult<ProbeValue> | undefined): {
  count: number | null;
  error?: "timeout" | "error";
} {
  if (!result) return { count: null, error: "error" };
  if (result.state === "timeout") return { count: null, error: "timeout" };
  if (result.state === "error") {
    return { count: null, error: isTimeout(result.error) ? "timeout" : "error" };
  }
  if (result.value.kind !== "secrets" || result.value.count === null) {
    return { count: null, error: "error" };
  }
  return { count: result.value.count };
}

const TIMED_OUT = `(timed out after ${STATUS_CHECK_TIMEOUT_MS / 1000}s)`;

function phantomDetail(loaded: LoadedStatus): string {
  if (loaded.installedError === "timeout") return `unknown ${TIMED_OUT}`;
  if (!loaded.phantomInstalled) return "not installed";
  if (loaded.secretCountError === "timeout") return `vault count unknown ${TIMED_OUT}`;
  return `${loaded.secretCount ?? 0} secrets in vault`;
}

/** Human lines in the historical order. `console.log` prints each one. */
export function statusLines(loaded: LoadedStatus): string[] {
  const { hasStack, config, phantomInstalled } = loaded;
  const lines = [
    "",
    colors.bold("  Ashlr Stack"),
    "",
    `  ${statusDot(hasStack)} .stack.toml       ${hasStack ? colors.dim(config?.stack.project_id) : colors.dim("missing — run `stack init`")}`,
    `  ${statusDot(phantomInstalled)} phantom           ${colors.dim(phantomDetail(loaded))}`,
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
        ...(loaded.secretCountError ? { secretCountError: loaded.secretCountError } : {}),
        ...(loaded.installedError ? { installedError: loaded.installedError } : {}),
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
