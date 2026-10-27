import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function emptyDir(): string {
  const d = mkdtempSync(join(tmpdir(), "stack-run-cli-"));
  created.push(d);
  return d;
}

function stack(args: string[], extraEnv: Record<string, string> = {}, preload?: string) {
  const cwd = emptyDir();
  const r = spawnSync("bun", [...(preload ? ["--preload", preload] : []), CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    // A minimal env: consola hides log output when it detects a test run,
    // so the child must not inherit the test runner's environment.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      NO_COLOR: "1",
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
      ...extraEnv,
    },
    timeout: 20_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("command errors", () => {
  test("outside a project: one line that says to run stack init, no stack trace", () => {
    const r = stack(["list"]);
    expect(r.code).toBe(1);
    const lines = r.stderr.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("No .stack.toml at");
    expect(lines[0]).toContain("Run `stack init` first.");
    expect(r.stderr).not.toMatch(/^\s+at /m);
  });

  test("STACK_DEBUG=1 adds the stack trace", () => {
    const r = stack(["list"], { STACK_DEBUG: "1" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Run `stack init` first.");
    expect(r.stderr).toMatch(/^\s+at /m);
  });

  test("usage errors still print usage and exit 1", () => {
    const r = stack(["info"]);
    expect(r.code).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("USAGE stack info");
  });

  test("a usage error under --json is one JSON error on stdout, no usage text", () => {
    const r = stack(["info", "--json"]);
    expect(r.code).toBe(1);
    expect(r.stdout).not.toContain("USAGE");
    const parsed = JSON.parse(r.stdout) as { error: string };
    expect(parsed.error).toContain("Missing required positional argument: SERVICE");
    expect(parsed.error).toContain("Run `stack info --help` for usage.");
  });

  test("--version still prints the version", () => {
    const r = stack(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("cold startup", () => {
  test("version forms never load command modules", () => {
    const preload = join(emptyDir(), "reject-commands.ts");
    writeFileSync(
      preload,
      `import { plugin } from "bun";
plugin({
  name: "reject-command-loads",
  setup(build) {
    build.onLoad({ filter: /[/\\\\]commands[/\\\\].*\\.ts$/ }, (args) => {
      throw new Error("Unexpected command module: " + args.path);
    });
  },
});`,
    );
    for (const args of [["--version"], ["-v"], ["--version", "--json"]]) {
      const r = stack(args, {}, preload);
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
      if (args.includes("--json")) {
        expect(JSON.parse(r.stdout).version).toMatch(/^\d+\.\d+\.\d+$/);
      } else {
        expect(r.stdout).toMatch(/\d+\.\d+\.\d+/);
      }
    }
    // Prove the guard is active when a command is actually selected.
    const selected = stack(["list"], {}, preload);
    expect(selected.code).not.toBe(0);
    expect(selected.stderr).toContain("Unexpected command module:");
  }, 20_000);

  test("version completes within a generous cold-start budget", () => {
    // Include process creation and module loading. This is a regression ceiling,
    // not a microbenchmark: allow substantial headroom for shared CI runners.
    const start = performance.now();
    const r = stack(["--version"]);
    const durationMs = performance.now() - start;
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(durationMs).toBeLessThan(5_000);
  });
});
