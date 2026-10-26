import { type FixRunner, NAME_RE, childEnv, cmdline, defaultFixRunner } from "./doctor-fix.ts";
import { ECOSYSTEM_TOOLS, type EcosystemEntry, checkEcosystem } from "./ecosystem.ts";

/**
 * `stack doctor --ecosystem --install [tools] [--apply <tools>]`: install the
 * missing or outdated Ashlr companions. Product call (a), Oct 25 2026: by
 * default Stack only prints the exact commands, in a safe order. It runs them
 * only for tools named in `--apply`, stops at the first non-zero exit, and
 * runs every command as a fixed argv (no shell) with the base env allowlist,
 * so no token or LOCUS_CONTROL_CAPABILITY reaches a package manager.
 *
 * Step order follows the measured first-run friction (adoption-audit.md,
 * Oct 25): Node 22.15+ first (npm only warns on the engine floor), then
 * phantom, locus, lexicon, then the manual ashlr-md step, and `phm doctor`
 * last, where exit 1 for an optional companion is expected.
 */
export interface InstallTool {
  /** Name as in ECOSYSTEM_TOOLS and in `--install` / `--apply`. */
  tool: string;
  /** Fixed argv; never built from user input. Absent means manual only. */
  argv?: string[];
  /** Minimum Node `[major, minor]` this install needs, checked first. */
  node?: [number, number];
  /** Shown when there is no argv, or when the argv cannot run here. */
  manual?: string;
  /** A one-line note printed with the step. */
  note?: string;
}

/**
 * locus-cli on npm is broken at these versions (`locus --version` loops, see
 * the locus README). While the newest published version is listed here, Stack
 * recommends the source install. When Locus publishes a fixed release
 * (tracked in ashlrai/locus, first-run fix after 0.5.1), set
 * LOCUS_NPM_FIXED to that version and npm becomes the recommendation again.
 */
export const LOCUS_NPM_BROKEN = ["0.5.0"];
export const LOCUS_NPM_FIXED: string | null = null;

export const LOCUS_CARGO_ARGV = [
  "cargo",
  "install",
  "--git",
  "https://github.com/ashlrai/locus",
  "locus-cli",
  "locus-mcp",
  "--locked",
];

export function locusInstall(fixed: string | null = LOCUS_NPM_FIXED): InstallTool {
  if (fixed && !LOCUS_NPM_BROKEN.includes(fixed))
    return { tool: "locus", argv: ["npm", "install", "-g", `locus-cli@${fixed}`] };
  return {
    tool: "locus",
    argv: LOCUS_CARGO_ARGV,
    note: `source install: locus-cli ${LOCUS_NPM_BROKEN.join(", ")} on npm is broken; needs Rust (rustup.rs), about 3 min`,
  };
}

/** Safe order. phantom-secrets and ashlr-plugin install through their own hosts. */
export function installTable(): InstallTool[] {
  return [
    { tool: "phantom", argv: ["npm", "install", "-g", "@ashlr/phantom"], node: [22, 15] },
    locusInstall(),
    { tool: "lexicon", argv: ["npm", "install", "-g", "@ashlr/lexicon"], node: [20, 0] },
    {
      tool: "ashlr-md",
      manual:
        "desktop app with the mdopener-mcp sidecar: install from https://github.com/ashlrai/ashlr-md/releases (see docs/INSTALL.md)",
    },
  ];
}

/** `phm doctor` is the last, read-only step; exit 1 for optional companions is expected. */
export const PHM_DOCTOR_ARGV = ["phm", "doctor"];
export const PHM_DOCTOR_NOTE =
  "exit 1 is expected while optional companions (locus, a local model) are missing";

export const INSTALL_TIMEOUT_MS = 900_000;
export const NODE_PROBE_TIMEOUT_MS = 5_000;

export type StepOutcome =
  | "planned"
  | "manual"
  | "blocked"
  | "installed"
  | "failed"
  | "not_run"
  | "checked";

export interface InstallStep {
  tool: string;
  /** Why it is in the plan. */
  reason: "missing" | "outdated" | "verify";
  command: string;
  outcome: StepOutcome;
  detail?: string;
  note?: string;
}

export interface InstallReport {
  mode: "preview" | "apply";
  plan: { node: string | null; steps: InstallStep[] };
  outcome: { stopped_at: string | null } | null;
}

export class InstallUsageError extends Error {}

/** Parse `v22.15.0` into [major, minor], or null. */
export function parseNode(out: string): [number, number] | null {
  const m = /^v?(\d+)\.(\d+)\./.exec(out.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function nodeOk(have: [number, number] | null, need: [number, number]): boolean {
  return have !== null && (have[0] > need[0] || (have[0] === need[0] && have[1] >= need[1]));
}

function whyPending(e: EcosystemEntry | undefined): "missing" | "outdated" | null {
  if (!e || e.status === "missing") return "missing";
  if (e.status === "no-handshake" || e.contract === "drift") return "outdated";
  if (e.name === "locus" && e.version && LOCUS_NPM_BROKEN.includes(e.version)) return "outdated";
  return null;
}

export interface InstallDeps {
  table?: InstallTool[];
  entries?: EcosystemEntry[];
  runner?: FixRunner;
  env?: NodeJS.ProcessEnv;
}

export async function runDoctorInstall(
  only: string[],
  apply: string[] | undefined,
  deps: InstallDeps = {},
): Promise<InstallReport> {
  const table = deps.table ?? installTable();
  const runner = deps.runner ?? defaultFixRunner;
  const env = childEnv([], deps.env);
  const label = (n: string) => (NAME_RE.test(n) ? `'${n}'` : "<invalid name>");
  const known = table.map((t) => t.tool).join(", ");
  for (const n of [...only, ...(apply ?? [])])
    if (!table.some((t) => t.tool === n))
      throw new InstallUsageError(
        `${label(n)} is not a tool Stack installs (${known}); nothing was run.`,
      );
  if (apply !== undefined && apply.length === 0)
    throw new InstallUsageError(
      "--apply needs the tools to install, named one by one; nothing was run.",
    );

  const entries =
    deps.entries ??
    (await checkEcosystem(
      undefined,
      table.map(
        (t) => ECOSYSTEM_TOOLS.find((e) => e.name === t.tool) ?? { name: t.tool, command: t.tool },
      ),
    ));
  const scope = table.filter((t) => only.length === 0 || only.includes(t.tool));
  const pending = scope
    .map((t) => ({ t, why: whyPending(entries.find((e) => e.name === t.tool)) }))
    .filter((p): p is { t: InstallTool; why: "missing" | "outdated" } => p.why !== null);
  if (apply)
    for (const n of apply)
      if (!pending.some((p) => p.t.tool === n))
        throw new InstallUsageError(
          `${n} is already installed and current, or outside --install; nothing was run.`,
        );

  // Node first: it decides whether the npm steps can run at all.
  const needsNode = pending.some((p) => p.t.node);
  const nodeRun = needsNode
    ? await runner("node", ["--version"], env, NODE_PROBE_TIMEOUT_MS)
    : null;
  const nodeVer =
    nodeRun?.kind === "exited" && nodeRun.code === 0 ? parseNode(nodeRun.stdout) : null;
  const nodeLabel = nodeVer ? `${nodeVer[0]}.${nodeVer[1]}` : needsNode ? "not found" : null;

  const steps: InstallStep[] = pending.map(({ t, why }) => {
    const command = t.argv ? cmdline(t.argv[0] as string, t.argv.slice(1)) : (t.manual ?? "");
    const base = { tool: t.tool, reason: why, command, ...(t.note ? { note: t.note } : {}) };
    if (!t.argv) return { ...base, outcome: "manual" as const, detail: t.manual };
    if (t.node && !nodeOk(nodeVer, t.node))
      return {
        ...base,
        outcome: "blocked" as const,
        detail: `needs Node ${t.node.join(".")}+ (found ${nodeLabel}); upgrade Node first (https://nodejs.org)`,
      };
    return { ...base, outcome: "planned" as const };
  });
  if (
    pending.some((p) => p.t.tool === "phantom") ||
    entries.some((e) => e.name === "phantom" && e.status !== "missing")
  )
    steps.push({
      tool: "phantom",
      reason: "verify",
      command: cmdline(PHM_DOCTOR_ARGV[0] as string, PHM_DOCTOR_ARGV.slice(1)),
      outcome: "planned",
      note: PHM_DOCTOR_NOTE,
    });

  if (apply === undefined)
    return { mode: "preview", plan: { node: nodeLabel, steps }, outcome: null };

  let stopped: string | null = null;
  for (const s of steps) {
    const selected = apply.includes(s.tool);
    if (s.reason === "verify") {
      if (!selected) continue;
      if (stopped) {
        s.outcome = "not_run";
        continue;
      }
      // Read-only check with the base env only; 0 and 1 both count as ran.
      const r = await runner("phm", PHM_DOCTOR_ARGV.slice(1), env, 60_000);
      s.outcome = r.kind === "exited" && (r.code === 0 || r.code === 1) ? "checked" : "failed";
      if (s.outcome === "failed") s.detail = "phm doctor could not run";
      continue;
    }
    if (!selected) continue;
    if (stopped) {
      s.outcome = "not_run";
      s.detail = `stopped at ${stopped}`;
      continue;
    }
    if (s.outcome === "manual") continue;
    if (s.outcome === "blocked") {
      stopped = s.tool;
      continue;
    }
    const t = table.find((x) => x.tool === s.tool) as InstallTool;
    const argv = t.argv as string[];
    const r = await runner(argv[0] as string, argv.slice(1), env, INSTALL_TIMEOUT_MS);
    if (r.kind === "exited" && r.code === 0) {
      s.outcome = "installed";
      continue;
    }
    stopped = s.tool;
    s.outcome = "failed";
    s.detail =
      r.kind === "exited"
        ? `exited ${r.code}; run \`${s.command}\` yourself to see why`
        : r.kind === "missing"
          ? `${argv[0]} not found${argv[0] === "cargo" ? "; install Rust from https://rustup.rs" : ""}`
          : r.kind === "timeout"
            ? "timed out"
            : "could not start";
  }
  return { mode: "apply", plan: { node: nodeLabel, steps }, outcome: { stopped_at: stopped } };
}

export function formatInstallReport(r: InstallReport): string[] {
  const lines: string[] = [];
  if (r.plan.node) lines.push(`  node  ${r.plan.node}`);
  if (r.plan.steps.length === 0)
    return [...lines, "  Every companion in scope is installed and current."];
  for (const s of r.plan.steps) {
    const extra = s.detail ? `: ${s.detail}` : s.note ? `  # ${s.note}` : "";
    lines.push(`  ${s.tool}  ${s.reason}  ${s.outcome}  ${s.command}${extra}`);
  }
  if (r.mode === "preview") {
    const runnable = [
      ...new Set(r.plan.steps.filter((s) => s.outcome === "planned").map((s) => s.tool)),
    ];
    lines.push(
      "",
      runnable.length
        ? `  Nothing was installed. To run these: stack doctor --ecosystem --install --apply ${runnable.join(",")}`
        : "  Nothing was installed.",
    );
  }
  return lines;
}
