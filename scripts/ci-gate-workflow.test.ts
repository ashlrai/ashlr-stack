import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ci = readFileSync(join(import.meta.dir, "../.github/workflows/ci.yml"), "utf8");
const jobs = ci.split(/^jobs:\n/m)[1] ?? "";
const blocks = jobs.split(/\n(?=  [a-z0-9-]+:\n)/);

function job(id: string): string {
  const block = blocks.find((b) => b.startsWith(`  ${id}:\n`) || b.startsWith(`${id}:\n`));
  expect(block, id).toBeDefined();
  return block ?? "";
}

test("CI Gate is required on every pull request and in merge_group", () => {
  expect(ci).toMatch(/^on:\n(?:  .*\n)*?  pull_request:\n/m);
  expect(ci).toMatch(/^  merge_group:\n/m);
  expect(ci).not.toMatch(/^ {2}paths:/m);
  expect(ci).not.toMatch(/pull_request_target|workflow_run|id-token:|secrets\./);
  const gate = job("gate");
  expect(gate).toMatch(/name: CI Gate\n/);
  expect(gate).toMatch(/if: always\(\)\n/);
  expect(gate).toMatch(/needs: \[fast, secret-scan, test, site, lint, secret-shape\]/);
  expect(gate).toMatch(/permissions: \{\}/);
});

test("every action is pinned and every checkout drops credentials", () => {
  const uses = [...ci.matchAll(/^ {6,}uses: (\S+)/gm)].map((m) => m[1] ?? "");
  expect(uses.length).toBeGreaterThan(0);
  for (const use of uses) {
    expect(use, use).toMatch(/@[0-9a-f]{40}$/);
  }
  const checkouts = ci.split("actions/checkout@").length - 1;
  const dropped = ci.split("persist-credentials: false").length - 1;
  expect(dropped).toBe(checkouts);
});

test("fork pull requests cannot fail on a cache write", () => {
  const fast = job("fast");
  expect(fast).not.toMatch(/uses: actions\/cache@/);
  expect(fast).toMatch(/uses: actions\/cache\/restore@/);
  expect(fast).toMatch(/uses: actions\/cache\/save@/);
  expect(fast).toMatch(/continue-on-error: true/);
  expect(fast).toMatch(/github\.event_name != 'pull_request'/);
  expect(fast).toMatch(/head\.repo\.full_name == github\.repository/);
  expect(fast).toMatch(
    /no-cache: "\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name != github\.repository \}\}"/,
  );
  for (const block of blocks) {
    if (!/uses: actions\/cache@/.test(block)) continue;
    expect(block).toMatch(/if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
  }
});

test("secret scans and Tier-1 tests still run on pull requests", () => {
  for (const id of ["fast", "secret-scan", "secret-shape"]) {
    const block = job(id);
    expect(block).not.toMatch(/\n    if:/);
    expect(block).not.toMatch(/paths:/);
  }
  const fast = job("fast");
  expect(fast).toContain("bun test packages/core/src/__tests__/security.test.ts packages/core/src/__tests__/secret-redaction.test.ts");
  expect(fast).toContain("bun run check:crypto");
  const shape = job("secret-shape");
  expect(shape).toContain("scrub.pl --check --allow-fixtures");
  expect(shape).toContain('git fetch --no-tags origin "${BASE_SHA}"');
  const scan = job("secret-scan");
  expect(scan).toContain('git fetch --no-tags origin "$sha"');
  expect(scan).not.toMatch(/\n\s+ref:/);
  expect(shape).not.toMatch(/\n\s+ref:/);
  expect(ci).not.toMatch(/contents: write|pull-requests:|id-token:/);
});
