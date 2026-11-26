import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coverageResult, diagnoseCoverage } from "./coverage-diagnostic.ts";

test.each([
  [0, null, 80, "passed", 0],
  [1, null, 80, "test-command-failed", 1],
  [1, null, 0, "test-command-failed", 1],
  [0, null, 0, "missing-artifact", 2],
  [null, null, 0, "runner-error", 3],
  [null, "SIGTERM", 80, "runner-error", 3],
] as const)("classifies exit=%s signal=%s bytes=%s", (code, signal, bytes, status, exit) => {
  expect(coverageResult(code, signal, bytes)).toMatchObject({ status, exit_code: exit });
});

test("real Bun runs distinguish failed tests, passing tests and missing artifacts", () => {
  const cwd = mkdtempSync(join(tmpdir(), "coverage-fixture-"));
  try {
    // An old artifact must never make a source-free run appear covered.
    mkdirSync(join(cwd, "coverage"));
    writeFileSync(join(cwd, "coverage/lcov.info"), "stale");
    writeFileSync(join(cwd, "source.ts"), "export function value() { return 42; }\n");
    const fixture = join(cwd, "fixture.test.ts");
    const sourceTest = (expected: number) =>
      `import {test,expect} from "bun:test"; import {value} from "./source.ts";
test("value", () => expect(value()).toBe(${expected}));`;
    writeFileSync(fixture, sourceTest(42));
    const passed = diagnoseCoverage(cwd);
    expect(passed.status).toBe("passed");
    expect(passed.artifact_bytes).toBeGreaterThan(0);
    writeFileSync(fixture, sourceTest(0));
    const cli = spawnSync(process.execPath, [join(import.meta.dir, "coverage-diagnostic.ts")], {
      cwd,
      encoding: "utf8",
    });
    const failed = JSON.parse(cli.stdout);
    expect(cli.status).toBe(1);
    expect(failed.status).toBe("test-command-failed");
    expect(failed.test_exit_code).toBe(1);
    expect(failed.artifact_bytes).toBeGreaterThan(0);
    writeFileSync(
      fixture,
      'import {test,expect} from "bun:test"; test("empty",()=>expect(true).toBe(true));',
    );
    expect(diagnoseCoverage(cwd)).toMatchObject({
      status: "missing-artifact",
      test_exit_code: 0,
      artifact_bytes: 0,
      exit_code: 2,
    });
    expect(readFileSync(join(cwd, "coverage/lcov.info"), "utf8")).toBe("stale");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("coverage options cannot be overridden by test filters", () => {
  expect(() => diagnoseCoverage(process.cwd(), ["--coverage-dir=coverage"])).toThrow(
    "test paths only",
  );
});

test("a stalled module emits a timeout report before an outer deadline", () => {
  const cwd = mkdtempSync(join(tmpdir(), "coverage-stalled-"));
  try {
    const scratch = join(cwd, "scratch");
    mkdirSync(scratch);
    // Bun's per-test timeout cannot interrupt module loading. Ignore SIGTERM
    // too: the diagnostic must stop the runner before its own caller times out.
    writeFileSync(
      join(cwd, "stalled.test.ts"),
      'import {writeFileSync} from "node:fs"; process.on("SIGTERM", () => {}); ' +
        'writeFileSync("started", "yes"); await new Promise(r => setTimeout(r, 4000));',
    );
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dir, "coverage-diagnostic.ts"), "--timeout-ms=1000"],
      {
        cwd,
        env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
        encoding: "utf8",
        timeout: 8000,
        killSignal: "SIGKILL",
      },
    );
    expect(result.error).toBeUndefined();
    expect(readFileSync(join(cwd, "started"), "utf8")).toBe("yes");
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "ashlr.stack.coverage-diagnostic/v1",
      status: "timed-out",
      signal: "SIGKILL",
      exit_code: 3,
    });
    expect(readdirSync(scratch)).toEqual([]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("a timeout fails even if the runner wrote coverage or exited during termination", () => {
  expect(coverageResult(0, null, 80, true)).toMatchObject({ status: "timed-out", exit_code: 3 });
});

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
  "invalid timeout %s cannot disable the deadline",
  (timeout) => {
    expect(() => diagnoseCoverage(process.cwd(), [], timeout)).toThrow("Timeout must be");
  },
);

test.each(["--timeout-ms=0", "--timeout-ms=500=invalid", "--coverage-dir=coverage"])(
  "CLI setup failure for %s still emits JSON",
  (arg) => {
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dir, "coverage-diagnostic.ts"), arg],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "runner-error", exit_code: 3 });
  },
);

test("diagnostic stays aligned with the workflow's coverage command and artifact", () => {
  const workflow = readFileSync(join(import.meta.dir, "../.github/workflows/coverage.yml"), "utf8");
  expect(workflow).toContain("bun test --coverage --coverage-reporter=lcov");
  expect(workflow).toContain("set -euo pipefail");
  expect(workflow).toContain("test -s coverage/lcov.info");
});
