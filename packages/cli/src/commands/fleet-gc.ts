import { homedir } from "node:os";
import { join } from "node:path";
import { defineCommand } from "citty";
import { collectFleetGc } from "../lib/fleet-gc.ts";

/**
 * fleet-gc — read-only dry-run report for stale fleet worktrees.
 *
 * Inventories the dispatcher's worktree root (default ~/Projects/ashlrai/wt),
 * reconciles each entry against fleet state under ~/.ashlr-runs and the owning
 * repository's `git worktree list`, and classifies every entry as `preserve`
 * (with reasons) or `collect-candidate` (with the evidence basis). The safety
 * boundary mirrors dispatchd/reap-one/reap-merged: running jobs, claimed,
 * locked, kept-for-supervisor, held, unpublished or unverifiable worktrees are
 * always preserved.
 *
 * This command never mutates anything: no deletes, no git writes, no fetches.
 * Collection itself stays with the dispatcher's lock-aware reapers — see
 * docs/worktree-gc-proposal.md. `--dry-run` is accepted for explicitness and is
 * the only mode.
 */
export const fleetGcCommand = defineCommand({
  meta: {
    name: "fleet-gc",
    description:
      "Dry-run report classifying fleet worktrees as preserved or collect-candidates (read-only).",
  },
  args: {
    json: { type: "boolean", description: "Emit schemaVersion 1 JSON." },
    root: {
      type: "string",
      description: "Worktree root (default: ~/Projects/ashlrai/wt).",
    },
    runs: {
      type: "string",
      description: "Fleet runs dir (default: ~/.ashlr-runs); queue defaults to <runs>/queue.",
    },
    queue: { type: "string", description: "Queue dir override (default: <runs>/queue)." },
    reapIdleHours: {
      type: "string",
      description: "Idle hours before RESULT PR worktrees are candidates (default 2).",
    },
    emptyIdleHours: {
      type: "string",
      description: "Idle hours before done/empty worktrees are candidates (default 6).",
    },
    budgetSeconds: {
      type: "string",
      description: "Seconds allowed for deep git/tree/gh inspection (default 120).",
    },
    ghBin: { type: "string", description: "gh binary override (default: PATH/install paths)." },
    lsofBin: { type: "string", description: "lsof binary override (default: system lsof)." },
    ghMax: {
      type: "string",
      description: "Cap on gh pr view calls (default 40).",
    },
    dryRun: {
      type: "boolean",
      description: "Accepted for explicitness; this command is always a dry run.",
    },
  },
  async run({ args }) {
    const num = (v: string | undefined, fallback: number) => {
      if (v === undefined) return fallback;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    const report = await collectFleetGc({
      root: args.root ?? join(homedir(), "Projects", "ashlrai", "wt"),
      runs: args.runs ?? join(homedir(), ".ashlr-runs"),
      queue: args.queue,
      reapIdleHours: num(args.reapIdleHours, 2),
      emptyIdleHours: num(args.emptyIdleHours, 6),
      budgetSeconds: num(args.budgetSeconds, 120),
      ghBin: args.ghBin,
      lsofBin: args.lsofBin,
      ghMax: num(args.ghMax, 40),
    });
    if (args.json) {
      console.log(JSON.stringify(report));
      return;
    }
    const s = report.summary;
    console.log(
      `fleet-gc dry-run: ${s.total} worktrees under ${report.root} — ${s.byClass["collect-candidate"]} collect-candidates, ${s.byClass.preserve} preserved (${report.scan.durationMs}ms)`,
    );
    for (const [basis, n] of Object.entries(s.byBasis).sort((a, b) => b[1] - a[1]))
      console.log(`  basis ${basis}: ${n}`);
    const topReasons = Object.entries(s.byReason)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
    for (const [reason, n] of topReasons) console.log(`  preserve ${reason}: ${n}`);
    if (report.staleRegistrations.count)
      console.log(
        `  stale git registrations under root (missing dirs): ${report.staleRegistrations.count}`,
      );
    if (!report.scan.complete)
      console.log(
        "  WARNING: scan incomplete (deep-inspection budget exhausted); candidates are a lower bound.",
      );
    const candidates = report.entries.filter((e) => e.class === "collect-candidate");
    for (const c of candidates.slice(0, 50))
      console.log(
        `  candidate ${c.name} basis=${c.basis} idle=${c.idleHours ?? "?"}h result=${c.resultClass ?? "none"}`,
      );
    if (candidates.length > 50)
      console.log(`  … and ${candidates.length - 50} more (--json for all)`);
  },
});
