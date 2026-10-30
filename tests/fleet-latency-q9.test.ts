import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectFleetLatency, percentile } from "../packages/cli/src/commands/fleet-latency.ts";

const now = Date.parse("2026-10-29T18:00:00Z");
const row = (seconds: number, merged = now) => ({
  created_at: new Date(merged - seconds * 1000).toISOString(),
  merged_at: new Date(merged).toISOString(),
  updated_at: new Date(merged).toISOString(),
});

test("percentiles interpolate sorted samples without mutating input", () => {
  const values = [40, 10, 30, 20];
  expect(percentile(values, 0.5)).toBe(25);
  expect(percentile(values, 0.9)).toBe(37);
  expect(values).toEqual([40, 10, 30, 20]);
  expect(percentile([], 0.9)).toBeNull();
  expect(percentile([0], 0.9)).toBe(0);
  expect(percentile([1, 3, 2], 0.5)).toBe(2);
  expect(percentile(values, 0)).toBe(10);
  expect(percentile(values, 1)).toBe(40);
  expect(() => percentile([NaN], 0.5)).toThrow();
  expect(() => percentile([1], 2)).toThrow();
});

test("six-hour merge window includes boundaries and long-lived PRs, excludes unmerged and future PRs", async () => {
  const report = await collectFleetLatency(async () => JSON.stringify([
    row(100), row(100000, now - 6 * 3600000), row(10, now + 1),
    { ...row(10, now - 6 * 3600000 - 1), updated_at: new Date(now).toISOString() },
    { ...row(10), merged_at: null },
  ]), now);
  expect(report.repos[0]).toEqual({ repo: "ashlrai/ashlr-stack", status: "ok", count: 2,
    medianSeconds: 50050, p90Seconds: 90010 });
  expect(report.windowStart).toBe("2026-10-29T12:00:00.000Z");
});

test("pagination includes all samples", async () => {
  const report = await collectFleetLatency(async (args) => {
    expect(args[0]).toBe("api");
    return JSON.stringify(args[1]?.endsWith("page=1") ? Array.from({ length: 100 }, () => row(10)) : [row(20)]);
  }, now);
  expect(report.repos.every((r) => r.count === 101 && r.medianSeconds === 10)).toBe(true);
});

test("JSON distinguishes no samples from unavailable or malformed data without leaking errors", async () => {
  for (const response of ["bad json", "{}", JSON.stringify([{ merged_at: null }]),
    JSON.stringify([{ ...row(1), created_at: null }]), JSON.stringify([row(-1)])]) {
    const report = await collectFleetLatency(async () => response, now);
    expect(report.repos.every((r) => r.status === "unavailable" && r.count === null && r.p90Seconds === null)).toBe(true);
  }
  const report = await collectFleetLatency(async (args) => {
    if (args[1]?.includes("/ashlr-stack/")) return "[]";
    throw new Error("private stderr");
  }, now);
  expect(report.repos[0]).toEqual({ repo: "ashlrai/ashlr-stack", status: "ok", count: 0, medianSeconds: null, p90Seconds: null });
  expect(JSON.stringify(report)).not.toContain("private stderr");
  expect(report.repos[1]?.status).toBe("unavailable");
});

test("CLI uses Locus and emits a single JSON document", async () => {
  const home = await mkdtemp(join(tmpdir(), "fleet-latency-"));
  try {
    await writeFile(join(home, "locus"), '#!/bin/sh\n[ "$1 $2 $3 $4" = "exec -- gh api" ] || exit 2\necho "[]"\n', { mode: 0o755 });
    const child = Bun.spawn([process.execPath, "run", "packages/cli/src/index.ts", "fleet-latency", "--json"], {
      env: { HOME: home, PATH: home }, stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    const report = JSON.parse(output);
    expect(report.schemaVersion).toBe(1);
    expect(report.repos).toHaveLength(7);
    expect(report.repos.every((r: { count: number }) => r.count === 0)).toBe(true);
  } finally { await rm(home, { recursive: true, force: true }); }
});
