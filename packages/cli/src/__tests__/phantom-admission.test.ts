import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

describe("CLI Phantom admission with an inert producer", () => {
  let root: string;
  let target: string;
  let launch: string;
  let bin: string;
  let log: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "stack-cli-admission-")));
    target = join(root, "target");
    launch = join(root, "launch");
    bin = join(root, "bin");
    log = join(root, "calls");
    for (const dir of [target, launch, bin, join(root, "home"), join(root, "registry")])
      mkdirSync(dir);
    writeFileSync(log, "");
    writeFileSync(
      join(target, ".stack.toml"),
      '[stack]\nversion = "1"\n[services.openai]\nprovider = "openai"\nsecrets = ["OPENAI_API_KEY"]\n',
    );
    writeFileSync(join(target, ".stack.local.toml"), '[stack]\nproject_id = "stk_fixture"\n');
    writeFileSync(
      join(root, "registry", "projects.json"),
      JSON.stringify({
        version: "1",
        projects: [
          {
            path: target,
            name: "target",
            project_id: "stk_fixture",
            services: ["openai"],
            last_seen: new Date(0).toISOString(),
          },
        ],
      }),
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function producer(
    opts: { list?: "known" | "failed" | "malformed" | "wrongshape"; initialized?: boolean } = {},
  ): void {
    const list =
      opts.list === "failed"
        ? "exit 9"
        : opts.list === "malformed"
          ? "echo not-json"
          : opts.list === "wrongshape"
            ? "echo '[\"OPENAI_API_KEY\"]'"
            : `if [ "$PWD" = ${quote(target)} ]; then echo '[{"name":"OPENAI_API_KEY"}]'; else echo '[]'; fi`;
    const script = `#!/bin/sh
printf '%s\\n' "$1" >> ${quote(log)}
case "$1" in
 --version) echo fixture;;
 status) echo '{"schema_version":1,"inspection":"metadata-only","initialized":${opts.initialized !== false}}';;
 list) ${list};;
 reveal) echo 'Refusing to reveal without attached terminals' >&2; exit 1;;
 *) exit 88;;
esac
`;
    writeFileSync(join(bin, "phantom"), script);
    chmodSync(join(bin, "phantom"), 0o700);
  }

  function runChild(command: string, args: string[], cwd: string, timeoutMs = 5_000) {
    // Known Bun executable, private homes/registry, finite child bound, inert
    // Phantom first on PATH. Credential environment variables are not forwarded.
    const started = performance.now();
    return new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      error?: Error;
      output: string;
      timedOut: boolean;
      pid?: number;
      elapsedMs: number;
    }>((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(command, args, {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            PATH: `${bin}:${process.env.PATH ?? ""}`,
            HOME: join(root, "home"),
            USERPROFILE: join(root, "home"),
            STACK_REGISTRY_DIR: join(root, "registry"),
            NO_COLOR: "1",
            CI: "1",
          },
        });
      } catch (error) {
        // Bun 1.2 throws ENOENT synchronously; newer versions emit error.
        resolve({
          code: null,
          signal: null,
          error: error as Error,
          output: "",
          timedOut: false,
          elapsedMs: performance.now() - started,
        });
        return;
      }
      let output = "";
      let timedOut = false;
      let settled = false;
      // Bun 1.2's sync facade treats exit 1 as a launch error and does not
      // forward timeout. Own the deadline and await close after a hard kill.
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      function finish(code: number | null, signal: NodeJS.Signals | null, error?: Error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          code,
          signal,
          error,
          output,
          timedOut,
          pid: child.pid,
          elapsedMs: performance.now() - started,
        });
      }
      child.stdout?.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.once("error", (error) => {
        if (child.pid) child.kill("SIGKILL");
        finish(null, null, error);
      });
      child.once("close", (code, signal) => finish(code, signal));
    });
  }

  async function run(args: string[], cwd: string) {
    const result = await runChild(process.execPath, [CLI_ENTRY, ...args], cwd);
    expect(result.error).toBeUndefined();
    expect(result.timedOut).toBe(false);
    expect(result.signal).toBeNull();
    expect(Number.isInteger(result.code)).toBe(true);
    return { code: result.code, output: result.output };
  }

  test.each([0, 1])("completed inert exit %i is distinct from a launch error", async (code) => {
    const result = await runChild(
      process.execPath,
      ["-e", `console.log("inert-completed");process.exit(${code})`],
      launch,
    );
    expect(result.error).toBeUndefined();
    expect(result.timedOut).toBe(false);
    expect(result.signal).toBeNull();
    expect(result.code).toBe(code);
    expect(result.output).toBe("inert-completed\n");
  });

  test("a short deadline kills and reaps its inert child", async () => {
    const result = await runChild(process.execPath, ["-e", "setInterval(()=>{},1000)"], launch, 50);
    expect(result.error).toBeUndefined();
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe("SIGKILL");
    expect(result.code).toBeNull();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(50);
    expect(result.elapsedMs).toBeLessThan(3_000);
    expect(result.pid).toBeGreaterThan(0);
    expect(() => process.kill(result.pid!, 0)).toThrow();
  });

  test("a missing inert executable reports a finite launch error", async () => {
    const result = await runChild(join(root, "absent-executable"), [], launch, 50);
    expect(result.error).toMatchObject({ code: "ENOENT" });
    expect(result.timedOut).toBe(false);
    expect(result.code).toBeNull();
    expect(result.elapsedMs).toBeLessThan(3_000);
  });

  test("doctor --all --fix screens the target vault, not the launch directory", async () => {
    producer();
    const result = await run(["doctor", "--all", "--fix"], launch);
    expect(result.code).toBe(1);
    expect(result.output).toContain("skipped — still stored in Phantom: OPENAI_API_KEY");
    expect(result.output).not.toContain("Re-running openai");
    expect(readFileSync(log, "utf8")).not.toMatch(/^add$|^init$/m);
  });

  test.each(["failed", "malformed", "wrongshape"] as const)(
    "doctor unavailable inventory blocks remediation (%s)",
    async (list) => {
      producer({ list });
      const result = await run(["doctor", "--all", "--fix"], launch);
      expect(result.code).toBe(1);
      expect(result.output).toContain("inventory is unavailable; remediation skipped");
      expect(result.output).not.toContain("Re-running openai");
      expect(readFileSync(log, "utf8")).not.toMatch(/^add$|^init$/m);
    },
  );

  test("import refuses uninitialized metadata before vault inventory or writes", async () => {
    producer({ initialized: false });
    const sentinel = "synthetic-import-value";
    writeFileSync(join(launch, ".env"), `OPENAI_API_KEY=${sentinel}\n`);
    const result = await run(["import"], launch);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("phantom init --empty");
    expect(result.output).not.toContain(sentinel);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["--version", "status"]);
    expect(readFileSync(join(launch, ".env"), "utf8")).toBe(`OPENAI_API_KEY=${sentinel}\n`);
  });
});
