import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CoverageDiagnostic {
  schema: "ashlr.stack.coverage-diagnostic/v1";
  status: "passed" | "test-command-failed" | "missing-artifact" | "runner-error";
  test_exit_code: number | null;
  signal: string | null;
  artifact_bytes: number;
  exit_code: 0 | 1 | 2 | 3;
}

export function coverageResult(
  testExitCode: number | null,
  signal: string | null,
  artifactBytes: number,
): CoverageDiagnostic {
  const status =
    testExitCode === null || signal !== null
      ? "runner-error"
      : testExitCode !== 0
        ? "test-command-failed"
        : artifactBytes === 0
          ? "missing-artifact"
          : "passed";
  return {
    schema: "ashlr.stack.coverage-diagnostic/v1",
    status,
    test_exit_code: testExitCode,
    signal,
    artifact_bytes: artifactBytes,
    exit_code:
      status === "passed"
        ? 0
        : status === "test-command-failed"
          ? 1
          : status === "missing-artifact"
            ? 2
            : 3,
  };
}

/** Reproduce Coverage's Bun command; isolate HOME and artifacts, stream test output to stderr. */
export function diagnoseCoverage(cwd: string, testFiles: string[] = []): CoverageDiagnostic {
  if (testFiles.some((path) => path.startsWith("-"))) {
    throw new Error("Pass test paths only; coverage options are fixed to match CI.");
  }
  const scratch = mkdtempSync(join(tmpdir(), "stack-coverage-"));
  try {
    const home = join(scratch, "home");
    const coverage = join(scratch, "coverage");
    mkdirSync(home);
    const result = spawnSync(
      process.execPath,
      ["test", "--coverage", "--coverage-reporter=lcov", "--coverage-dir", coverage, ...testFiles],
      {
        cwd,
        env: { ...process.env, HOME: home },
        stdio: ["ignore", 2, 2],
      },
    );
    const artifact = statSync(join(coverage, "lcov.info"), { throwIfNoEntry: false });
    return coverageResult(result.status, result.signal, artifact?.isFile() ? artifact.size : 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const report = diagnoseCoverage(process.cwd(), process.argv.slice(2));
  console.log(JSON.stringify(report));
  process.exitCode = report.exit_code;
}
