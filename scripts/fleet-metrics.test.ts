import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fleetMetrics } from "./fleet-metrics.ts";

const start = "2026-01-01T00:00:00Z";
const end = "2026-01-08T00:00:00Z";
test("summarizes a publish cohort and fixed failure signatures without raw values", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fleet-metrics-"));
  try {
    const path = join(dir, "jobs");
    const rows = [
      { event: "outcome", ts: end, url: "https://example/pr/1", state: "MERGED", secret: "PRIVATE_VALUE" },
      { event: "publish", ts: start, lane: "codex", repo: "stack", class: "pr", url: "https://example/pr/1" },
      { event: "publish", ts: start, lane: "codex", repo: "stack", class: "pr", url: "https://example/pr/1" },
      { event: "publish", ts: start, lane: "codex", repo: "stack", class: "pr", url: "https://example/pr/2" },
      { event: "launch", ts: start, lane: "codex", repo: "stack" },
      { event: "finish", ts: end, lane: "codex", repo: "stack", empty: true, error: "PRIVATE_VALUE" },
      { event: "precheck_skip", ts: start, lane: "codex", repo: "stack", code: "PRIVATE_VALUE" },
      { event: "launch", ts: "bad", lane: "codex" },
      { event: "launch", ts: "2025-01-01T00:00:00Z", lane: "codex" },
    ];
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n"));
    const report = await fleetMetrics(path, start, end);
    expect(report.groups).toEqual([{ lane: "codex", repo: "stack", launches: 1, reaps: 1, publishes: 3, prs: 2, merged: 1, mergeYield: 0.5 }]);
    expect(report.failureSignatures).toEqual([{ signature: "empty_finish", count: 1 }, { signature: "precheck_skip", count: 1 }]);
    expect(report.invalidTimestamps).toBe(1);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_VALUE");
    expect(JSON.stringify(report)).not.toContain("example");
    await writeFile(path, "bad\n");
    await expect(fleetMetrics(path, start, end)).rejects.toThrow();
    const link = join(dir, "link");
    await symlink(path, link);
    await expect(fleetMetrics(link, start, end)).rejects.toThrow();
    await expect(fleetMetrics(path, end, start)).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
