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
  expect(scan).toContain('git fetch --no-tags origin "$base"');
  expect(scan).not.toMatch(/\n\s+ref:/);
  expect(shape).not.toMatch(/\n\s+ref:/);
  expect(ci).not.toMatch(/contents: write|pull-requests:|id-token:/);
});

test("secret scan does not fall back to HEAD~1 on pull_request or merge_group", () => {
  const scan = job("secret-scan");
  const script = scan.slice(scan.indexOf("run: |"));
  expect(script).toContain('pull_request) base="$PR_BASE"');
  expect(script).toContain('merge_group) base="$MG_BASE"');
  expect(script).toContain('schedule|workflow_dispatch) base="${HEAD_SHA}~1"');
  expect(script.split("HEAD_SHA}~1").length - 1).toBe(1);
  expect(script).not.toMatch(/then base="\$\{HEAD_SHA\}~1"/);
  expect(script).not.toContain("fetch_if_missing");
  expect(script).toMatch(/\[\[ "\$base" =~ \^\[0-9a-f\]\{40\}\$ \]\] && ! git cat-file -e "\$\{base\}\^\{commit\}"/);
  expect(script).toContain('git fetch --no-tags origin "$base" || true');
  expect(script).toMatch(/if \[ -z "\$base" \] \|\| ! git cat-file -e "\$\{base\}\^\{commit\}"/);
  expect(script).toContain("refusing to scan a shorter range");
  expect(script).toContain("exit 1");
  const shape = job("secret-shape");
  expect(shape).toContain("5aa902abedbb3bf7fa8d893b93969e247c82ff62ac26cd082215caabfb740265");
  expect(shape).toContain("scrub.pl --check --allow-fixtures");
});

test("OS gates report beside CI Gate and do not join its needs", () => {
  expect(job("gate")).toMatch(/needs: \[fast, secret-scan, test, site, lint, secret-shape\]/);
  for (const [id, name] of [
    ["gate-linux", "Gate (linux)"],
    ["gate-windows", "Gate (windows)"],
    ["gate-macos", "Gate (macos)"],
    ["install-smoke-linux", "install smoke (linux)"],
    ["install-smoke-windows", "install smoke (windows)"],
    ["install-smoke-macos", "install smoke (macos)"],
  ] as const) {
    const block = job(id);
    expect(block).toContain(`name: ${name}\n`);
  }
  for (const id of ["gate-linux", "gate-windows", "gate-macos"]) {
    const block = job(id);
    expect(block).toMatch(/if: always\(\)\n/);
    expect(block).toMatch(/runs-on: ubuntu-latest\n/);
    expect(block).toContain("node scripts/ci-os-gate.mjs");
  }
  expect(job("gate-linux")).toContain("needs: [classify, fast, secret-scan, secret-shape, install-smoke-linux]");
  expect(job("install-smoke-linux")).toContain("needs: classify");
  expect(job("install-smoke-linux")).toContain("needs.classify.outputs.run_os == 'true'");
  expect(job("gate-windows")).toContain("needs: [classify, os-windows, install-smoke-windows]");
  expect(job("gate-macos")).toContain("needs: [classify, os-macos, install-smoke-macos]");
  expect(job("os-windows")).toContain("runs-on: windows-latest");
  expect(job("os-macos")).toContain("runs-on: macos-latest");
  expect(job("classify")).toContain("node scripts/ci-os-scope.mjs");
  expect(job("install-smoke-linux")).toContain("bun scripts/ci-install-smoke.mjs release");
  expect(ci).not.toMatch(/pull_request_target|workflow_run|id-token:|secrets\./);
});
