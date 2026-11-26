import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 600_000;

export interface CoverageDiagnostic {
  schema: "ashlr.stack.coverage-diagnostic/v1";
  status: "passed" | "test-command-failed" | "missing-artifact" | "runner-error" | "timed-out";
  test_exit_code: number | null;
  signal: string | null;
  artifact_bytes: number;
  exit_code: 0 | 1 | 2 | 3;
}

export function coverageResult(
  testExitCode: number | null,
  signal: string | null,
  artifactBytes: number,
  timedOut = false,
): CoverageDiagnostic {
  const status = timedOut
    ? "timed-out"
    : testExitCode === null || signal !== null
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
export function diagnoseCoverage(
  cwd: string,
  testFiles: string[] = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): CoverageDiagnostic {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error("Timeout must be a positive integer no greater than 2147483647 milliseconds.");
  }
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
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      },
    );
    const artifact = statSync(join(coverage, "lcov.info"), { throwIfNoEntry: false });
    return coverageResult(
      result.status,
      result.signal,
      artifact?.isFile() ? artifact.size : 0,
      result.error !== undefined && "code" in result.error && result.error.code === "ETIMEDOUT",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  let report: CoverageDiagnostic;
  try {
    const args = process.argv.slice(2);
    const prefix = "--timeout-ms=";
    const timeout = args[0]?.startsWith(prefix)
      ? Number(args.shift()?.slice(prefix.length))
      : DEFAULT_TIMEOUT_MS;
    report = diagnoseCoverage(process.cwd(), args, timeout);
  } catch {
    console.error(
      "Coverage diagnostic could not run. Check test paths, timeout and directory access.",
    );
    report = coverageResult(null, null, 0);
  }
  console.log(JSON.stringify(report));
  process.exitCode = report.exit_code;
}
