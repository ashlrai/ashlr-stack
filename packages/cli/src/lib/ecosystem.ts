import { spawn } from "node:child_process";

/** One Ashlr tool `stack doctor --ecosystem` probes. */
export interface EcosystemTool {
  name: string;
  command: string;
}

export const ECOSYSTEM_TOOLS: EcosystemTool[] = [
  { name: "phantom", command: "phm" },
  { name: "phantom-secrets", command: "phantom" },
  { name: "locus", command: "locus" },
  { name: "lexicon", command: "lexicon" },
  { name: "ashlr-md", command: "mdopener-mcp" },
  { name: "ashlr-plugin", command: "ashlr-plugin" },
];

export const PROBE_TIMEOUT_MS = 2000;

/** Result of running one probe. `missing` means the binary was not found. */
export type ProbeRun =
  | { kind: "ran"; code: number | null; stdout: string }
  | { kind: "missing" }
  | { kind: "timeout" };

export type ProbeRunner = (command: string, timeoutMs: number) => Promise<ProbeRun>;

export interface EcosystemEntry {
  name: string;
  command: string;
  /** `ok` answered v1; `missing` not installed; `no-handshake` installed but too old or unparseable. */
  status: "ok" | "missing" | "no-handshake";
  version?: string;
  capabilities?: string[];
  health?: string;
  detail?: string;
}

/**
 * Env for probes: PATH and locale/home basics only, so no token or secret in
 * this process's environment reaches another tool.
 */
export function probeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TMPDIR", "SYSTEMROOT", "PATHEXT"];
  const out: NodeJS.ProcessEnv = {};
  for (const key of keep) if (env[key] !== undefined) out[key] = env[key];
  out.NO_COLOR = "1";
  return out;
}

export const defaultProbeRunner: ProbeRunner = (command, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const done = (r: ProbeRun) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, ["--ashlr-handshake", "--json"], {
        env: probeEnv(),
        stdio: ["ignore", "pipe", "ignore"],
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      });
    } catch {
      done({ kind: "missing" });
      return;
    }
    child.stdout?.on("data", (d) => {
      if (stdout.length < 64_000) stdout += String(d);
    });
    child.on("error", (err: NodeJS.ErrnoException) =>
      done(err.code === "ENOENT" ? { kind: "missing" } : { kind: "ran", code: 1, stdout: "" }),
    );
    child.on("close", (code, signal) =>
      done(
        signal === "SIGKILL" && code === null ? { kind: "timeout" } : { kind: "ran", code, stdout },
      ),
    );
  });

export function parseHandshake(tool: EcosystemTool, run: ProbeRun): EcosystemEntry {
  const base = { name: tool.name, command: tool.command };
  if (run.kind === "missing") return { ...base, status: "missing", detail: "not installed" };
  if (run.kind === "timeout")
    return { ...base, status: "no-handshake", detail: "did not answer in time" };
  try {
    const v = JSON.parse(run.stdout.trim());
    if (v?.kind !== "ashlr.handshake" || v.schema_version !== 1) throw new Error("shape");
    return {
      ...base,
      status: "ok",
      version: typeof v.version === "string" ? v.version : undefined,
      capabilities: Array.isArray(v.capabilities)
        ? v.capabilities.filter((c: unknown) => typeof c === "string")
        : [],
      health: typeof v.health?.status === "string" ? v.health.status : undefined,
    };
  } catch {
    return {
      ...base,
      status: "no-handshake",
      detail: "installed, but too old to answer --ashlr-handshake",
    };
  }
}

/** Probes every tool in parallel. Never throws; nothing here is a failure. */
export async function checkEcosystem(
  runner: ProbeRunner = defaultProbeRunner,
  tools: EcosystemTool[] = ECOSYSTEM_TOOLS,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<EcosystemEntry[]> {
  return Promise.all(
    tools.map(async (tool) => {
      const run = await runner(tool.command, timeoutMs).catch(
        (): ProbeRun => ({ kind: "missing" }),
      );
      return parseHandshake(tool, run);
    }),
  );
}

/** Handshake capability a locus build advertises when `locus doctor --fix` exists. */
export const LOCUS_DOCTOR_FIX_CAPABILITY = "doctor-fix";

/**
 * Suggested next steps for installed tools. Today: `locus doctor --fix` when
 * locus answered the handshake, reports health other than `ok`, and itself
 * advertises the `doctor-fix` capability. No version guessing: a locus that
 * does not advertise the capability gets no suggestion. Healthy: nothing.
 */
export function ecosystemNextSteps(entries: EcosystemEntry[]): string[] {
  const steps: string[] = [];
  const locus = entries.find((e) => e.name === "locus");
  if (
    locus?.status === "ok" &&
    locus.health !== undefined &&
    locus.health !== "ok" &&
    locus.capabilities?.includes(LOCUS_DOCTOR_FIX_CAPABILITY)
  ) {
    steps.push(
      "locus doctor --fix   # preview safe repairs (writes nothing); add --apply to make them",
    );
  }
  return steps;
}

export function formatEcosystem(entries: EcosystemEntry[]): string[] {
  const lines = formatEcosystemEntries(entries);
  const steps = ecosystemNextSteps(entries);
  if (steps.length) {
    lines.push("", "  Next steps:");
    for (const s of steps) lines.push(`    ${s}`);
  }
  return lines;
}

function formatEcosystemEntries(entries: EcosystemEntry[]): string[] {
  return entries.map((e) => {
    if (e.status === "ok") {
      const caps = e.capabilities?.length ? ` [${e.capabilities.join(", ")}]` : "";
      const health = e.health && e.health !== "ok" ? ` (health: ${e.health})` : "";
      return `  ok   ${e.name} ${e.version ?? "?"}${caps}${health}`;
    }
    return `  --   ${e.name} (${e.command}): ${e.detail}`;
  });
}
