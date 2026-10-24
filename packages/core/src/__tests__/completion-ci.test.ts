import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "..", "cli", "src", "index.ts");

describe("stack completion", () => {
  test("zsh output is a loadable compdef script", () => {
    const res = spawnSync("bun", ["run", CLI, "completion", "zsh"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^#compdef stack/);
    expect(res.stdout).toContain("_stack()");
    expect(res.stdout).toContain('"supabase"');
  });

  test("bash output registers complete -F", () => {
    const res = spawnSync("bun", ["run", CLI, "completion", "bash"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("_stack_completion()");
    expect(res.stdout).toContain("complete -F _stack_completion stack");
  });

  test("fish output registers complete commands", () => {
    const res = spawnSync("bun", ["run", CLI, "completion", "fish"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("complete -c stack");
  });

  test("unknown shell exits non-zero", () => {
    const res = spawnSync("bun", ["run", CLI, "completion", "powershell"], { encoding: "utf-8" });
    expect(res.status).not.toBe(0);
  });
});

const CI_UNAVAILABLE =
  "CI health workflow unavailable: Phantom Cloud pull requires trusted-terminal approval. No workflow was written.";

interface CiFixture {
  cwd: string;
  env: Record<string, string>;
}

async function withCiFixture(
  configured: boolean,
  run: (fixture: CiFixture) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "stack-ci-refusal-"));
  try {
    for (const dir of ["project", "home", "tmp", "registry", "xdg"]) {
      mkdirSync(join(root, dir));
    }
    const cwd = join(root, "project");
    if (configured) {
      writeFileSync(
        join(cwd, ".stack.toml"),
        '[stack]\nversion = "1"\nproject_id = "synthetic-ci-project"\n',
      );
    }
    const env: Record<string, string> = {
      PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
      HOME: join(root, "home"),
      USERPROFILE: join(root, "home"),
      TMPDIR: join(root, "tmp"),
      TMP: join(root, "tmp"),
      TEMP: join(root, "tmp"),
      XDG_CONFIG_HOME: join(root, "xdg"),
      XDG_CACHE_HOME: join(root, "xdg"),
      XDG_DATA_HOME: join(root, "xdg"),
      STACK_REGISTRY_DIR: join(root, "registry"),
      CI: "true",
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
      PHANTOM_CLOUD_TOKEN: "SYNTHETIC-CLOUD-DO-NOT-PRINT",
      PHANTOM_VAULT_PASSPHRASE: "SYNTHETIC-VAULT-DO-NOT-PRINT",
    };
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    await run({ cwd, env });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function projectSnapshot(cwd: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  function visit(dir: string, prefix = ""): void {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name);
      const key = `${prefix}${name}`;
      const stat = lstatSync(file);
      if (stat.isDirectory()) {
        snapshot[key] = `directory:${stat.mode}`;
        visit(file, `${key}/`);
      } else if (stat.isFile()) {
        snapshot[key] = `file:${stat.mode}:${readFileSync(file).toString("hex")}`;
      } else {
        throw new Error("Unexpected CI fixture entry");
      }
    }
  }
  visit(cwd);
  return snapshot;
}

// Reuse the existing async fixture transport: Bun 1.2's sync facade can
// mislabel exit 1 and does not reliably enforce timeout/output bounds.
function runBoundedCiFixture(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
) {
  return new Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    outputLimitExceeded: boolean;
  }>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      // Bun 1.2 throws launch errors synchronously; newer runtimes emit error.
      resolve({
        status: null,
        signal: null,
        error: error instanceof Error ? error : new Error("fixture launch failed"),
        stdout: "",
        stderr: "",
        timedOut: false,
        outputLimitExceeded: false,
      });
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let error: Error | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 1500);
    function capture(chunks: Buffer[], chunk: Buffer) {
      if (outputLimitExceeded) return;
      const remaining = 64 * 1024 - bytes;
      const retained = chunk.subarray(0, remaining);
      chunks.push(Buffer.from(retained));
      bytes += retained.length;
      if (chunk.length > remaining) {
        outputLimitExceeded = true;
        child.kill("SIGKILL");
      }
    }
    child.stdout?.on("data", (chunk: Buffer) => capture(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => capture(stderr, chunk));
    child.once("error", (failure) => {
      error = failure;
      if (child.pid) child.kill("SIGKILL");
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      resolve({
        status,
        signal,
        error,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        outputLimitExceeded,
      });
    });
  });
}

async function runCi(fixture: CiFixture, args: string[] = []) {
  const result = await runBoundedCiFixture(
    process.execPath,
    ["run", CLI, "ci", "init", ...args],
    fixture.cwd,
    fixture.env,
  );
  expect(result.error).toBeUndefined();
  expect(result.timedOut).toBe(false);
  expect(result.outputLimitExceeded).toBe(false);
  expect(result.signal).toBeNull();
  expect(result.status).not.toBeNull();
  const output = result.stdout + result.stderr;
  expect(output).not.toContain("SYNTHETIC-CLOUD-DO-NOT-PRINT");
  expect(output).not.toContain("SYNTHETIC-VAULT-DO-NOT-PRINT");
  return { result, output };
}

async function expectUnavailable(fixture: CiFixture, args: string[] = []): Promise<void> {
  const before = projectSnapshot(fixture.cwd);
  const { result, output } = await runCi(fixture, args);
  expect(result.status).toBe(1);
  expect(output).toContain(CI_UNAVAILABLE);
  expect(output).not.toContain("CI workflow scaffolded.");
  expect(output).not.toContain("PHANTOM_CLOUD_TOKEN");
  expect(output).not.toContain("PHANTOM_VAULT_PASSPHRASE");
  expect(projectSnapshot(fixture.cwd)).toEqual(before);
}

describe("stack ci init", async () => {
  test("preserves missing-config refusal without creating workflow parents", async () => {
    await withCiFixture(false, async (fixture) => {
      const before = projectSnapshot(fixture.cwd);
      const { result, output } = await runCi(fixture);
      expect(result.status).toBe(1);
      expect(output).toContain("No .stack.toml found. Run `stack init` first.");
      expect(projectSnapshot(fixture.cwd)).toEqual(before);
      expect(existsSync(join(fixture.cwd, ".github"))).toBe(false);
    });
  });

  test("refuses the unsupported Cloud scaffold before creating either parent", async () => {
    await withCiFixture(true, async (fixture) => {
      await expectUnavailable(fixture);
      expect(existsSync(join(fixture.cwd, ".github"))).toBe(false);
    });
  });

  test("leaves an existing workflow directory and unrelated file unchanged", async () => {
    await withCiFixture(true, async (fixture) => {
      const dir = join(fixture.cwd, ".github", "workflows");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "owned.yml"), "owner sentinel\n");
      await expectUnavailable(fixture);
    });
  });

  test("preserves the existing-file guard without force", async () => {
    await withCiFixture(true, async (fixture) => {
      const dir = join(fixture.cwd, ".github", "workflows");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "stack-ci.yml"), "owner sentinel\n");
      const before = projectSnapshot(fixture.cwd);
      const { result, output } = await runCi(fixture);
      expect(result.status).toBe(1);
      expect(output).toContain("already exists. It was not changed.");
      expect(projectSnapshot(fixture.cwd)).toEqual(before);
    });
  });

  test("force cannot overwrite an existing workflow with an unsupported scaffold", async () => {
    await withCiFixture(true, async (fixture) => {
      const dir = join(fixture.cwd, ".github", "workflows");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "stack-ci.yml"), "owner sentinel\n");
      await expectUnavailable(fixture, ["--force"]);
    });
  });

  test("preserves help and the force flag without creating files", async () => {
    await withCiFixture(false, async (fixture) => {
      const before = projectSnapshot(fixture.cwd);
      const { result, output } = await runCi(fixture, ["--help"]);
      expect(result.status).toBe(0);
      expect(output).toContain("--force");
      expect(projectSnapshot(fixture.cwd)).toEqual(before);
    });
  });
});
