import { afterEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { shouldRelaySignal } from "../commands/exec.ts";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

/** A `phantom` that answers --version and runs `exec -- cmd` directly. */
function fakePhantomDir(): string {
  const dir = tmp("stack-exec-phantom-");
  const bin = join(dir, "phantom");
  writeFileSync(
    bin,
    `#!/bin/sh
case "$1" in
  --version) echo "phantom fake 0.0.1" ;;
  exec) shift; [ "$1" = "--" ] && shift; exec "$@" ;;
  *) exit 0 ;;
esac
`,
  );
  chmodSync(bin, 0o755);
  return dir;
}

function runExec(args: string[], cwd: string) {
  const r = spawnSync("bun", [CLI_ENTRY, "exec", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: "1",
      STACK_NO_TELEMETRY: "1",
      PATH: `${fakePhantomDir()}:${process.env.PATH ?? ""}`,
    },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? 0 };
}

describe("stack exec stdout", () => {
  test("stdout carries only the wrapped command's output", () => {
    const cwd = tmp("stack-exec-proj-");
    writeFileSync(join(cwd, ".stack.toml"), '[stack]\nversion = "1"\n');
    const r = runExec(["--", "sh", "-c", "echo PAYLOAD"], cwd);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("PAYLOAD\n");
  });

  test("errors go to stderr, not stdout", () => {
    const cwd = tmp("stack-exec-noconf-");
    const r = runExec(["--", "true"], cwd);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("No .stack.toml found");
  });

  test("bare stack exec says a command is missing, even without a project or Phantom", () => {
    // It used to answer with "run stack init" or the Phantom install hint.
    const cwd = tmp("stack-exec-bare-");
    const r = spawnSync(process.execPath, [CLI_ENTRY, "exec"], {
      cwd,
      encoding: "utf8",
      env: { HOME: cwd, NO_COLOR: "1", STACK_TELEMETRY: "0", PATH: dirname(process.execPath) },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Nothing to run. Usage: stack exec -- <command>");
    expect(r.stderr).not.toContain("Phantom");
  });
});

describe("stack exec exit status", () => {
  function project(): string {
    const cwd = tmp("stack-exec-sig-");
    writeFileSync(join(cwd, ".stack.toml"), '[stack]\nversion = "1"\n');
    return cwd;
  }

  test("a non-zero exit code passes through", () => {
    const r = runExec(["--", "sh", "-c", "exit 3"], project());
    expect(r.code).toBe(3);
  });

  test("a command killed by a signal is not reported as success", () => {
    const r = runExec(["--", "sh", "-c", "kill -9 $$"], project());
    // 128 + SIGKILL(9), the shell convention; it used to exit 0.
    expect(r.code).toBe(137);
    expect(r.stderr).toContain("killed by SIGKILL");
  });

  test("SIGTERM to stack exec reaches the wrapped command", async () => {
    const cwd = project();
    const started = join(cwd, "started");
    const marker = join(cwd, "survived");
    const script = `touch ${started}; sleep 2; touch ${marker}`;
    const child = spawn("bun", [CLI_ENTRY, "exec", "--", "sh", "-c", script], {
      cwd,
      stdio: "ignore",
      env: {
        ...process.env,
        NO_COLOR: "1",
        STACK_NO_TELEMETRY: "1",
        PATH: `${fakePhantomDir()}:${process.env.PATH ?? ""}`,
      },
    });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
      child.on("close", (code, signal) => resolve({ code, signal })),
    );
    // Signal only once the wrapped command is running (stack is waiting on it).
    for (let i = 0; i < 100 && !existsSync(started); i++) await Bun.sleep(50);
    expect(existsSync(started)).toBe(true);
    child.kill("SIGTERM");
    const result = await exited;
    // stack waits for the wrapped command and reports 128 + SIGTERM(15).
    expect(result).toEqual({ code: 143, signal: null });
    await Bun.sleep(2_000);
    expect(existsSync(marker)).toBe(false);
  }, 10_000);
});

describe("stack exec on a terminal", () => {
  test("Ctrl-C and hangup are not relayed on a terminal; TERM always is", () => {
    expect(shouldRelaySignal("SIGINT", true)).toBe(false);
    expect(shouldRelaySignal("SIGHUP", true)).toBe(false);
    expect(shouldRelaySignal("SIGTERM", true)).toBe(true);
    expect(shouldRelaySignal("SIGINT", false)).toBe(true);
    expect(shouldRelaySignal("SIGHUP", false)).toBe(true);
    expect(shouldRelaySignal("SIGTERM", false)).toBe(true);
  });

  // A real Ctrl-C typed into a pty reaches the whole foreground process group,
  // the wrapped command included. Relaying it as well delivered a second
  // SIGINT, which tools like terraform read as "exit immediately".
  const hasPython = spawnSync("python3", ["--version"]).status === 0;
  test.skipIf(process.platform === "win32" || !hasPython)(
    "one Ctrl-C on a terminal reaches the wrapped command once",
    () => {
      const cwd = tmp("stack-exec-pty-");
      writeFileSync(join(cwd, ".stack.toml"), '[stack]\nversion = "1"\n');
      const log = join(cwd, "sigint.log");
      const started = join(cwd, "started");
      const wrapped = join(cwd, "wrapped.mjs");
      writeFileSync(
        wrapped,
        `import { appendFileSync, writeFileSync } from "node:fs";
process.on("SIGINT", () => appendFileSync(${JSON.stringify(log)}, "INT\\n"));
writeFileSync(${JSON.stringify(started)}, "");
setTimeout(() => process.exit(7), 1000);
`,
      );
      const driver = `
import os, pty, sys, time
started, argv = sys.argv[1], sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
for _ in range(200):
    if os.path.exists(started): break
    time.sleep(0.05)
os.write(fd, b"\\x03")
while True:
    try:
        if not os.read(fd, 1024): break
    except OSError: break
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
`;
      // Relaying races the terminal's own delivery, so repeat to catch it.
      for (let i = 0; i < 4; i++) {
        rmSync(log, { force: true });
        rmSync(started, { force: true });
        const r = spawnSync(
          "python3",
          ["-I", "-c", driver, started, "bun", CLI_ENTRY, "exec", "--", process.execPath, wrapped],
          {
            cwd,
            encoding: "utf8",
            env: {
              ...process.env,
              NO_COLOR: "1",
              STACK_NO_TELEMETRY: "1",
              PATH: `${fakePhantomDir()}:${process.env.PATH ?? ""}`,
            },
          },
        );
        expect(existsSync(started)).toBe(true);
        expect(readFileSync(log, "utf8")).toBe("INT\n");
        expect(r.status).toBe(7);
      }
    },
    30_000,
  );
});
