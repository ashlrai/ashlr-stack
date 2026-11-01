import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleetBets, leaderBets } from "../commands/fleet-bets.ts";

const LEDGER = [
  "- CLAIMED 09:12 devin RQ-VAN (P1, pool=devin, tier=work, repo=ashlr-stack, src=leader): gone",
  "- READY RQ-WAIT (P1, pool=devin, tier=work, repo=ashlr-stack, src=leader): queued upstream",
  "- READY RQ-RUN r2 (P2, pool=codex-cmp, tier=mid, repo=phantom, src=leader): in flight",
  "- READY RQ-EMPTY (P2, pool=devin, tier=work, repo=ashlr-stack, src=leader): noop",
  "- READY RQ-OPEN (P2, pool=devin, tier=work, repo=ashlr-stack, src=leader): published",
  "- MERGED RQ-MERGED (P1, pool=devin, tier=work, repo=ashlr-stack, src=leader): landed",
  "- READY RQ-OTHER (P3, pool=devin, tier=work, repo=ashlr-stack, src=mason): not a bet",
  "- READY junk (not a job line)",
].join("\n");

async function fixture(run: (dir: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "fleet-bets-"));
  const queue = join(root, "queue");
  const metrics = join(root, "metrics");
  try {
    await mkdir(metrics, { recursive: true });
    await mkdir(queue);
    await writeFile(join(queue, "router-queue.md"), LEDGER);
    await writeFile(
      join(queue, "ready.tsv"),
      "RQ-WAIT\tashlr-stack\tdevin\twork\t/private/prompts/RQ-WAIT.md\n",
    );
    await writeFile(
      join(metrics, "jobs.jsonl"),
      [
        { event: "launch", job: "RQ-RUN", lane: "codex-cmp", tokens: "private" },
        { event: "launch", job: "RQ-EMPTY", lane: "devin" },
        { event: "finish", job: "RQ-EMPTY", lane: "devin", empty: true, diff_files: 0 },
        { event: "launch", job: "RQ-OPEN", lane: "devin" },
        { event: "finish", job: "RQ-OPEN", lane: "devin", empty: false, diff_files: 3 },
        {
          event: "publish",
          job: "RQ-OPEN",
          lane: "devin",
          url: "https://github.com/ashlrai/ashlr-stack/pull/240",
          class: "pr",
        },
        { event: "launch", job: "RQ-MERGED", lane: "devin" },
        { event: "finish", job: "RQ-MERGED", lane: "devin", empty: false, diff_files: 5 },
        {
          event: "publish",
          job: "RQ-MERGED",
          lane: "devin",
          url: "https://github.com/ashlrai/ashlr-stack/pull/235",
          class: "pr",
        },
        {
          event: "outcome",
          url: "https://github.com/ashlrai/ashlr-stack/pull/235",
          state: "MERGED",
          ttm_s: 210,
        },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n"),
    );
    await run(queue);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("joins leader bets to queue and outcomes; a vanished bet and an empty job", () =>
  fixture(async (queue) => {
    const report = await collectFleetBets(queue);
    expect(report.bets.map((b) => [b.id, b.status])).toEqual([
      ["RQ-EMPTY", "empty"],
      ["RQ-MERGED", "merged"],
      ["RQ-OPEN", "open"],
      ["RQ-RUN", "running"],
      ["RQ-VAN", "vanished"],
      ["RQ-WAIT", "waiting"],
    ]);
    expect(report.bets.find((b) => b.id === "RQ-VAN")).toMatchObject({
      leaderStatus: "CLAIMED",
      lane: "devin",
      evidence: { queued: false, launched: false, outcome: null },
    });
    expect(report.bets.find((b) => b.id === "RQ-MERGED")).toMatchObject({
      url: "https://github.com/ashlrai/ashlr-stack/pull/235",
      evidence: { publishClass: "pr", outcome: "MERGED" },
    });
    expect(report.totals).toMatchObject({ bets: 6, merged: 1, resolved: 2, mergedRate: 0.5 });
    expect(report.lanes).toEqual([
      {
        lane: "codex-cmp",
        bets: 1,
        merged: 0,
        open: 0,
        empty: 0,
        running: 1,
        waiting: 0,
        vanished: 0,
        resolved: 0,
        mergedRate: null,
      },
      {
        lane: "devin",
        bets: 5,
        merged: 1,
        open: 1,
        empty: 1,
        running: 0,
        waiting: 1,
        vanished: 1,
        resolved: 2,
        mergedRate: 0.5,
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("private");
  }));

test("leader status fallback, missing files and symlink refusal keep the scorecard honest", () =>
  fixture(async (queue) => {
    expect(leaderBets("- READY RQ-ONLY (src=leader): x", "leader").get("RQ-ONLY")).toMatchObject({
      status: "READY",
      pool: null,
    });
    const root = await mkdtemp(join(tmpdir(), "fleet-bets-empty-"));
    try {
      await mkdir(join(root, "queue"));
      const empty = await collectFleetBets(join(root, "queue"));
      expect(empty.sources).toEqual({ router: "missing", ready: "missing", metrics: "missing" });
      expect(empty.bets).toEqual([]);
      await writeFile(
        join(root, "queue", "router-queue.md"),
        "- DONE RQ-BOOK (P1, pool=devin, src=leader): done\nbroken line\n",
      );
      expect((await collectFleetBets(join(root, "queue"))).bets[0]).toMatchObject({
        status: "merged",
      });
      await rm(join(root, "queue", "router-queue.md"));
      await writeFile(join(root, "token"), "- READY RQ-X (src=leader): x");
      await symlink(join(root, "token"), join(root, "queue", "router-queue.md"));
      expect((await collectFleetBets(join(root, "queue"))).sources.router).toBe("invalid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }));

test("CLI emits the same JSON and a compact text scorecard", () =>
  fixture(async (queue) => {
    const root = join(queue, "..");
    for (const json of [false, true]) {
      const child = Bun.spawn(
        [
          process.execPath,
          "run",
          "packages/cli/src/index.ts",
          "fleet-bets",
          "--queue",
          queue,
          ...(json ? ["--json"] : []),
        ],
        {
          env: {
            HOME: root,
            PATH: process.env.PATH ?? "",
            STACK_NO_UPDATE_CHECK: "1",
            STACK_TELEMETRY: "0",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      if (json) expect(JSON.parse(output)).toEqual(await collectFleetBets(queue));
      else {
        expect(output).toContain("RQ-VAN: vanished (devin)");
        expect(output).toContain("devin: 1/2 resolved merged over 5 bets");
        expect(output).toContain("total: 1/2 resolved merged over 6 bets");
      }
    }
  }));
