import { spawn } from "node:child_process";
import { ECOSYSTEM_TOOLS, type EcosystemEntry, checkEcosystem } from "./ecosystem.ts";

/**
 * `stack doctor --ecosystem --fix [--apply <tools>]`: run each companion's own
 * `doctor --fix`, gated on its handshake capability. Stack only lists,
 * previews (when the tool documents its preview as read-only) and, with a
 * per-tool opt-in, runs the tool's own apply command. It never adds
 * capabilities, tokens or flags of its own; the companion's safety rules
 * decide what happens.
 */
export interface FixTool {
  /** Name as in ECOSYSTEM_TOOLS and in `--apply <name>`. */
  tool: string;
  command: string;
  /** Handshake capability that must be advertised. */
  capability: string;
  previewArgv: string[];
  /** Only true when the tool documents its preview as writing nothing. */
  previewReadOnly: boolean;
  applyArgv: string[];
  /** Non-secret variables the tool needs to see the same store. */
  envPassthrough: string[];
  /** Summarize preview stdout, or null when the shape is not confirmed. */
  summarizePreview?: (stdout: string) => string | null;
}

/**
 * locus: docs/doctor-fix.md ("`locus doctor --fix` previews repairs and writes
 * nothing"; `--json` gives `{mode, plan, outcome}` with `plan.fixes` and
 * `plan.report_only` arrays). Lexicon and ashlr-md join this table once their
 * `doctor-fix` commands exist; until then they show as info.
 */
export const FIX_TOOLS: FixTool[] = [
  {
    tool: "locus",
    command: "locus",
    capability: "doctor-fix",
    previewArgv: ["doctor", "--fix", "--json"],
    previewReadOnly: true,
    applyArgv: ["doctor", "--fix", "--apply"],
    envPassthrough: ["LOCUS_HOME"],
    summarizePreview: summarizeLocusPreview,
  },
];

export function summarizeLocusPreview(stdout: string): string | null {
  try {
    const v = JSON.parse(stdout);
    if (
      v?.mode !== "dry_run" ||
      !Array.isArray(v.plan?.fixes) ||
      !Array.isArray(v.plan?.report_only)
    )
      return null;
    return `${v.plan.fixes.length} fix(es) would be applied, ${v.plan.report_only.length} finding(s) to handle by hand`;
  } catch {
    return null;
  }
}

/** Same allowlist as `stack exec --as`, plus Windows process basics. Never tokens. */
const BASE_ENV_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SYSTEMROOT",
  "HOME",
  "USERPROFILE",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TEMP",
  "TMP",
];

export function fixEnv(
  tool: FixTool,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [...BASE_ENV_KEYS, ...tool.envPassthrough]) {
    const value = source[key];
    if (typeof value === "string" && value !== "") env[key] = value;
  }
  env.NO_COLOR = "1";
  return env;
}

export const PREVIEW_TIMEOUT_MS = 15_000;
export const APPLY_TIMEOUT_MS = 120_000;
export const MAX_OUTPUT = 256 * 1024;

export type RunResult =
  | { kind: "exited"; code: number; stdout: string }
  | { kind: "missing" }
  | { kind: "timeout" }
  | { kind: "error" };

export type FixRunner = (
  command: string,
  argv: string[],
  env: Record<string, string>,
  timeoutMs: number,
) => Promise<RunResult>;

export const defaultFixRunner: FixRunner = (command, argv, env, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const done = (r: RunResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, argv, {
        env,
        stdio: ["ignore", "pipe", "ignore"],
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      });
    } catch {
      done({ kind: "error" });
      return;
    }
    child.stdout?.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT) stdout += String(d).slice(0, MAX_OUTPUT - stdout.length);
    });
    child.on("error", (err: NodeJS.ErrnoException) =>
      done(err.code === "ENOENT" ? { kind: "missing" } : { kind: "error" }),
    );
    child.on("close", (code, signal) => {
      if (signal === "SIGKILL" && code === null) done({ kind: "timeout" });
      else if (typeof code === "number") done({ kind: "exited", code, stdout });
      else done({ kind: "error" });
    });
  });

export type ToolOutcome =
  | "available"
  | "previewed"
  | "preview_failed"
  | "applied"
  | "refused"
  | "failed"
  | "not_run"
  | "no_capability"
  | "missing";

export interface ToolReport {
  tool: string;
  capability: string | null;
  /** The command a person can run (preview, or apply in apply mode). */
  command: string;
  preview: string | null;
  outcome: ToolOutcome;
  detail?: string;
}

export interface FixReport {
  mode: "preview" | "apply";
  tools: ToolReport[];
  stopped_at: string | null;
}

const NAME_RE = /^[a-z0-9-]{1,32}$/;

/** Parse `--apply` from raw argv: undefined (absent), [] (bare) or tool names. */
export function parseApplyArg(rawArgs: string[]): string[] | undefined {
  let found: string | undefined;
  let seen = false;
  for (let i = 0; i < rawArgs.length; i++) {
    const tok = rawArgs[i] as string;
    if (tok === "--") break;
    if (tok === "--apply") {
      seen = true;
      const next = rawArgs[i + 1];
      found = next !== undefined && !next.startsWith("-") ? next : "";
      if (found) i++;
    } else if (tok.startsWith("--apply=")) {
      seen = true;
      found = tok.slice("--apply=".length);
    }
  }
  if (!seen) return undefined;
  return (found ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function cmdline(command: string, argv: string[]): string {
  return [command, ...argv].join(" ");
}

function capabilityOf(entry: EcosystemEntry | undefined, tool: FixTool): boolean {
  return entry?.status === "ok" && (entry.capabilities ?? []).includes(tool.capability);
}

export interface FixDeps {
  table?: FixTool[];
  entries?: EcosystemEntry[];
  runner?: FixRunner;
  env?: NodeJS.ProcessEnv;
}

/** Usage error: returns a message and runs nothing. */
export class FixUsageError extends Error {}

export async function runDoctorFix(
  apply: string[] | undefined,
  deps: FixDeps = {},
): Promise<FixReport> {
  const table = deps.table ?? FIX_TOOLS;
  const runner = deps.runner ?? defaultFixRunner;
  const entries =
    deps.entries ??
    (await checkEcosystem(
      undefined,
      table.map(
        (t) =>
          ECOSYSTEM_TOOLS.find((e) => e.name === t.tool) ?? { name: t.tool, command: t.command },
      ),
    ));
  const entryFor = (t: FixTool) => entries.find((e) => e.name === t.tool);
  const eligible = table.filter((t) => capabilityOf(entryFor(t), t)).map((t) => t.tool);

  if (apply === undefined) {
    const tools: ToolReport[] = [];
    for (const t of table) {
      const entry = entryFor(t);
      if (!capabilityOf(entry, t)) {
        tools.push({
          tool: t.tool,
          capability: null,
          command: cmdline(t.command, t.previewArgv),
          preview: null,
          outcome: entry?.status === "missing" ? "missing" : "no_capability",
          detail:
            entry?.status === "missing"
              ? "not installed"
              : `does not advertise the ${t.capability} capability`,
        });
        continue;
      }
      if (!t.previewReadOnly) {
        tools.push({
          tool: t.tool,
          capability: t.capability,
          command: cmdline(t.command, t.previewArgv),
          preview: null,
          outcome: "available",
        });
        continue;
      }
      const r = await runner(t.command, t.previewArgv, fixEnv(t, deps.env), PREVIEW_TIMEOUT_MS);
      const summary =
        r.kind === "exited" && r.code === 0 ? (t.summarizePreview?.(r.stdout) ?? null) : null;
      tools.push({
        tool: t.tool,
        capability: t.capability,
        command: cmdline(t.command, t.previewArgv),
        preview: summary,
        outcome: summary !== null ? "previewed" : "preview_failed",
        ...(summary === null
          ? {
              detail: `run \`${cmdline(
                t.command,
                t.previewArgv.filter((a) => a !== "--json"),
              )}\` to see the preview`,
            }
          : {}),
      });
    }
    return { mode: "preview", tools, stopped_at: null };
  }

  const hint = eligible.length
    ? `eligible: ${eligible.join(", ")} (e.g. --apply ${eligible.join(",")})`
    : "no installed tool advertises doctor-fix";
  if (apply.length === 0) throw new FixUsageError(`--apply needs the tools to fix; ${hint}`);
  for (const name of apply) {
    const t = table.find((x) => x.tool === name);
    if (!t) {
      const label = NAME_RE.test(name) ? `'${name}'` : "<invalid name>";
      throw new FixUsageError(
        `${label} has no doctor --fix Stack can run; nothing was run. ${hint}`,
      );
    }
    if (!capabilityOf(entryFor(t), t)) {
      throw new FixUsageError(
        `${t.tool} does not advertise the ${t.capability} capability; nothing was run. ${hint}`,
      );
    }
  }

  const ordered = [...new Set(apply)].map((n) => table.find((x) => x.tool === n) as FixTool);
  const tools: ToolReport[] = [];
  let stopped: string | null = null;
  for (const t of ordered) {
    const base = {
      tool: t.tool,
      capability: t.capability,
      command: cmdline(t.command, t.applyArgv),
      preview: null,
    };
    if (stopped) {
      tools.push({ ...base, outcome: "not_run", detail: `stopped at ${stopped}` });
      continue;
    }
    const r = await runner(t.command, t.applyArgv, fixEnv(t, deps.env), APPLY_TIMEOUT_MS);
    if (r.kind === "exited" && r.code === 0) {
      tools.push({ ...base, outcome: "applied" });
      continue;
    }
    stopped = t.tool;
    const detail =
      r.kind === "exited"
        ? `exited ${r.code}; ${t.tool}'s own rules refused or a fix was skipped. Run \`${base.command}\` yourself to see why.`
        : r.kind === "timeout"
          ? "timed out"
          : r.kind === "missing"
            ? "not installed"
            : "could not start";
    tools.push({ ...base, outcome: r.kind === "exited" ? "refused" : "failed", detail });
  }
  return { mode: "apply", tools, stopped_at: stopped };
}

export function formatFixReport(report: FixReport): string[] {
  const lines: string[] = [];
  for (const t of report.tools) {
    const extra = t.preview ? `: ${t.preview}` : t.detail ? `: ${t.detail}` : "";
    lines.push(`  ${t.tool}  ${t.command}  ${t.outcome}${extra}`);
  }
  if (report.mode === "preview") {
    const ready = report.tools.filter((t) => t.capability !== null).map((t) => t.tool);
    lines.push(
      "",
      ready.length
        ? `  Nothing was changed. To apply: stack doctor --ecosystem --fix --apply ${ready.join(",")}`
        : "  Nothing was changed. No installed tool advertises doctor-fix.",
    );
  }
  return lines;
}
