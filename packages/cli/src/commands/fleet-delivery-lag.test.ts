import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportFleetDeliveryLag } from "./fleet-delivery-lag.ts";

const now = Date.parse("2026-10-30T12:00:00Z");
const date = (seconds: number) => new Date(now - seconds * 1000).toISOString();
const sha = (n: number) => n.toString(16).padStart(40, "0");
const row = (n: number, mergedAt: string | null = date(10)) => ({
  sha: sha(n),
  createdAt: date(100),
  mergedAt,
});
const fixture = (commits: unknown[] = [row(1), row(2), row(3, date(30)), row(4, null)]) => ({
  latestDeployed: { version: "v1.2.3", commits: [sha(1)] },
  commits,
});

test("reports deployed, missing and awaiting merge; oldest pending uses merge time without mutating input", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const report = reportFleetDeliveryLag(input, now);
  expect(report).toMatchObject({
    schemaVersion: 1,
    status: "ok",
    deployedVersion: "v1.2.3",
    missingCount: 2,
    oldestPendingCommit: sha(3),
  });
  expect(
    report.commits.map((r) => [r.status, r.mergeWaitSeconds, r.awaitingDeploymentSeconds]),
  ).toEqual([
    ["deployed", 90, null],
    ["missing", 90, 10],
    ["missing", 70, 30],
    ["awaiting-merge", 100, null],
  ]);
  expect(JSON.stringify(input)).toBe(before);
});

test("empty, fully deployed and zero-duration snapshots are valid; tied oldest is deterministic", () => {
  for (const commits of [[], [row(1)]])
    expect(reportFleetDeliveryLag(fixture(commits), now)).toMatchObject({
      status: "ok",
      missingCount: 0,
      oldestPendingCommit: null,
    });
  const report = reportFleetDeliveryLag(
    fixture([{ ...row(2, date(0)), createdAt: date(0) }, row(5), row(3)]),
    now,
  );
  expect(report.commits[0]).toMatchObject({ mergeWaitSeconds: 0, awaitingDeploymentSeconds: 0 });
  expect(report.oldestPendingCommit).toBe(sha(3));
});

test("malformed records are explicit, duplicates are rejected and valid records survive", () => {
  for (const bad of [
    null,
    [],
    {},
    { ...row(2), sha: "bad" },
    { ...row(2), createdAt: null },
    row(2, "2026-02-30T12:00:00Z"),
    row(2, date(101)),
    row(2, date(-1)),
    { ...row(2), createdAt: date(-1) },
    { ...row(2), mergedAt: undefined },
    row(1, null),
  ]) {
    const report = reportFleetDeliveryLag(fixture([bad, row(3)]), now);
    expect(report).toMatchObject({
      status: "partial",
      missingCount: 1,
      oldestPendingCommit: sha(3),
    });
    expect(report.commits[0]).toMatchObject({
      status: "malformed",
      mergeWaitSeconds: null,
      awaitingDeploymentSeconds: null,
    });
  }
  expect(
    reportFleetDeliveryLag(fixture([row(2), row(2)]), now).commits.every(
      (r) => r.status === "malformed",
    ),
  ).toBe(true);
});

test("missing or malformed deployment evidence never becomes a known empty deployment", () => {
  for (const input of [
    null,
    {},
    { commits: [] },
    { ...fixture(), latestDeployed: null },
    { ...fixture(), commits: null },
    { ...fixture(), latestDeployed: { version: "v1", commits: ["short"] } },
    { ...fixture(), latestDeployed: { version: "\u001bprivate", commits: [] } },
  ])
    expect(reportFleetDeliveryLag(input, now)).toMatchObject({
      status: "unavailable",
      missingCount: null,
      oldestPendingCommit: null,
    });
});

test("CLI reads only the fixture, handles unavailable inputs, and registers help/completion", async () => {
  const home = await mkdtemp(join(tmpdir(), "delivery-lag-"));
  const path = join(home, "fixture.json");
  const snapshot = fixture();
  const contents = JSON.stringify(snapshot).replaceAll("2026-10-30", "2020-10-30");
  const cli = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, "packages/cli/src/index.ts", ...args], {
      env: { HOME: home, PATH: "", STACK_NO_UPDATE_CHECK: "1", STACK_TELEMETRY: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(err).toBe("");
    return { out, code };
  };
  try {
    await writeFile(path, contents, { mode: 0o444 });
    const result = await cli("fleet-delivery-lag", "--fixture", path, "--json");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({ missingCount: 2, oldestPendingCommit: sha(3) });
    expect((await cli("fleet-delivery-lag", "--fixture", path)).out).toContain(
      `oldest pending=${sha(3)}`,
    );
    expect(await readFile(path, "utf8")).toBe(contents);
    await symlink(path, join(home, "link"));
    await writeFile(join(home, "bad"), "private invalid JSON");
    for (const bad of ["absent", "bad", "link", "."]) {
      const result = await cli("fleet-delivery-lag", "--fixture", join(home, bad), "--json");
      expect(result.code).toBe(1);
      expect(JSON.parse(result.out)).toMatchObject({ status: "unavailable", missingCount: null });
      expect(result.out).not.toContain("private");
    }
    expect((await cli("fleet-delivery-lag", "--help")).out).toContain("--fixture");
    expect((await cli("--help")).out).toContain("fleet-delivery-lag");
    for (const shell of ["bash", "zsh", "fish"])
      expect((await cli("completion", shell)).out).toContain("fleet-delivery-lag");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 30000);
