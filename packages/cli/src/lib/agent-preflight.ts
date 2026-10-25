import { spawnSync } from "node:child_process";

/**
 * Opt-in Phantom agent preflight for `stack exec`, following phantom-secrets
 * docs/agent-preflight-contract.md (schema_version 1): it runs
 * `phantom agent doctor --json --strict`, which reads only project files and
 * environment variables (no vault, no keychain) and prints a value-free
 * verdict. `--strict` exits 0 ready, 2 degraded, 1 blocked, 3 could not
 * evaluate.
 *
 * Off unless STACK_PHANTOM_PREFLIGHT is set:
 *   1 / true / on  refuse only on `blocked`; warn on degraded or unknown
 *   strict         refuse on anything but `ready`
 * A missing phantom, or one without `agent doctor`, is a warning, never a
 * refusal: the preflight degrades to "not evaluated".
 */

export type PreflightMode = "off" | "on" | "strict";
export type Verdict = "ready" | "degraded" | "blocked" | "unknown";

export interface PreflightOutcome {
  /** null when the preflight was off or could not run. */
  verdict: Verdict | null;
  /** Ids of the critical checks (`wrap.blocked_by`). Ids only, never values. */
  blockedBy: string[];
  /** Whether `stack exec` should stop before running the command. */
  refuse: boolean;
  /** One line for stderr, or null when there is nothing to say. */
  message: string | null;
}

export type PreflightRunner = () => { status: number | null; stdout: string; missing: boolean };

export function preflightMode(env: NodeJS.ProcessEnv = process.env): PreflightMode {
  const v = (env.STACK_PHANTOM_PREFLIGHT ?? "").trim().toLowerCase();
  if (v === "strict") return "strict";
  if (v === "1" || v === "true" || v === "on") return "on";
  return "off";
}

const defaultRunner: PreflightRunner = () => {
  const r = spawnSync("phantom", ["agent", "doctor", "--json", "--strict"], {
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  // Bun 1.2.0 sets `error` even on a normal exit, so trust `status` first.
  const missing =
    r.status === null && (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  return { status: r.status ?? null, stdout: r.stdout ?? "", missing };
};

const VERDICT_BY_EXIT: Record<number, Verdict> = {
  0: "ready",
  2: "degraded",
  1: "blocked",
  3: "unknown",
};
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parse(stdout: string): { verdict: Verdict; blockedBy: string[] } | null {
  try {
    const doc = JSON.parse(stdout) as {
      schema_version?: unknown;
      kind?: unknown;
      verdict?: unknown;
      wrap?: { blocked_by?: unknown };
    };
    if (doc.kind !== "phantom.agent.preflight" || doc.schema_version !== 1) return null;
    if (!["ready", "degraded", "blocked", "unknown"].includes(doc.verdict as string)) return null;
    const ids = Array.isArray(doc.wrap?.blocked_by) ? doc.wrap.blocked_by : [];
    // The contract promises kebab-case ids only; drop anything else rather than echo it.
    const blockedBy = ids.filter((id): id is string => typeof id === "string" && ID.test(id));
    return { verdict: doc.verdict as Verdict, blockedBy };
  } catch {
    return null;
  }
}

export function runAgentPreflight(
  mode: PreflightMode = preflightMode(),
  run: PreflightRunner = defaultRunner,
): PreflightOutcome {
  if (mode === "off") return { verdict: null, blockedBy: [], refuse: false, message: null };
  const r = run();
  if (r.missing) {
    return {
      verdict: null,
      blockedBy: [],
      refuse: false,
      message: "phantom preflight skipped: phantom is not installed",
    };
  }
  const parsed = parse(r.stdout);
  // The JSON is the source of truth; the exit code is the cross-check. An exit
  // outside 0-3 or a body that is not the v1 preflight means this phantom
  // has no `agent doctor` (or a newer schema): do not guess, just warn.
  if (!parsed || r.status === null || !(r.status in VERDICT_BY_EXIT)) {
    return {
      verdict: null,
      blockedBy: [],
      refuse: false,
      message: "phantom preflight skipped: this phantom has no `agent doctor --json` (schema 1)",
    };
  }
  const { verdict, blockedBy } = parsed;
  const refuse = verdict === "blocked" || (mode === "strict" && verdict !== "ready");
  let message: string | null = null;
  if (verdict === "blocked") {
    message = `phantom preflight: blocked${blockedBy.length ? ` (${blockedBy.join(", ")})` : ""}. Run \`phantom agent doctor\` for details.`;
  } else if (verdict !== "ready") {
    message = `phantom preflight: ${verdict}${refuse ? "" : ", continuing"}. Run \`phantom agent doctor\` for details.`;
  }
  return { verdict, blockedBy, refuse, message };
}
