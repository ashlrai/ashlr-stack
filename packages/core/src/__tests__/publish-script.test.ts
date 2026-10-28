import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceScript = resolve(import.meta.dir, "../../../../scripts/publish.sh");
const sourceWorkflow = resolve(import.meta.dir, "../../../../.github/workflows/release.yml");
// Resolve the runner's existing Node before installing the private effect-trap PATH.
const nodePath = Bun.which("node");
if (!nodePath) throw new Error("Node is required for copied read-only release preflight tests");
const realNode = realpathSync(nodePath);
const validatorProgram = readFileSync(sourceScript, "utf8")
  .split("<<'STACK_RELEASE_SOURCE'\n")[1]
  ?.split("\nSTACK_RELEASE_SOURCE")[0];
if (!validatorProgram) throw new Error("copied release validator is missing");
const validatorHash = createHash("sha256").update(`${validatorProgram}\n`).digest("hex");

function workflowBlock(name: string) {
  const source = readFileSync(sourceWorkflow, "utf8");
  const marker = `name: ${name}\n`;
  const start = source.indexOf(marker);
  if (start < 0 || source.indexOf(marker, start + 1) >= 0)
    throw new Error("ambiguous fixture step");
  const tail = source.slice(start + marker.length);
  const run = tail.indexOf("        run: |\n");
  if (run < 0) throw new Error("fixture step has no run block");
  const lines = tail.slice(run + "        run: |\n".length).split("\n");
  const block: string[] = [];
  for (const line of lines) {
    if (line && !line.startsWith("          ")) break;
    block.push(line.slice(10));
  }
  return block.join("\n");
}

const mutatingCommands = ["npm", "node", "git", "cp", "mv"];

// Bun 1.2's sync facade mislabels nonzero exits and ignores its timeout/buffer
// options. Own both bounds and await close so each copied fixture is reaped.
function runFixture(command: string, args: string[], cwd: string, env: Record<string, string>) {
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

describe("publish script early parser (copied script, inert commands)", () => {
  let root: string;
  let script: string;
  let trace: string;
  let env: Record<string, string>;
  let preserved: Array<{ path: string; bytes: Buffer }>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "stack-publish-parser-"));
    const bin = join(root, "bin");
    const scripts = join(root, "scripts");
    const home = join(root, "home");
    const temp = join(root, "tmp");
    for (const directory of [bin, scripts, home, temp]) mkdirSync(directory, { mode: 0o700 });
    script = join(scripts, "publish.sh");
    writeFileSync(script, readFileSync(sourceScript), { mode: 0o700 });
    trace = join(root, "operations.log");
    writeFileSync(trace, "", { mode: 0o600 });
    for (const command of mutatingCommands) {
      const trap = join(bin, command);
      writeFileSync(
        trap,
        `#!/bin/bash\nprintf '%s\\n' '${command}' >> "$SCRIPT_FIXTURE_TRACE"\nexit 97\n`,
        { mode: 0o700 },
      );
      chmodSync(trap, 0o700);
    }
    // The only real Node program allowed is the exact copied, read-only validator.
    // This is a test binding, not a sandbox or publisher/account attestation.
    writeFileSync(
      join(bin, "node-reader.cjs"),
      `const {readFileSync, appendFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const input = readFileSync(0);
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== '--input-type=module' || args[1] !== '-'
    || createHash('sha256').update(input).digest('hex') !== '${validatorHash}') {
  appendFileSync(process.env.SCRIPT_FIXTURE_TRACE, 'node\\n'); process.exit(97);
}
appendFileSync(process.env.VALIDATOR_TRACE, 'read\\n');
const result = spawnSync(${JSON.stringify(realNode)}, args, {
  cwd: process.cwd(), env: process.env, input, timeout: 1000, maxBuffer: 64 * 1024,
});
if (result.error || result.signal || result.status === null) process.exit(98);
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
process.exit(result.status);
`,
      { mode: 0o700 },
    );
    // A Bash wrapper quotes Node paths containing spaces; a shebang cannot.
    writeFileSync(
      join(bin, "node"),
      `#!/bin/bash\nexec ${JSON.stringify(realNode)} ${JSON.stringify(join(bin, "node-reader.cjs"))} "$@"\n`,
      { mode: 0o700 },
    );
    symlinkSync("/usr/bin/dirname", join(bin, "dirname"));
    symlinkSync("/bin/cat", join(bin, "cat"));
    // No inherited startup files, loader options, registry credentials or auth environment.
    env = {
      HOME: home,
      TMPDIR: temp,
      PATH: bin,
      LANG: "C",
      LC_ALL: "C",
      SCRIPT_FIXTURE_TRACE: trace,
      VALIDATOR_TRACE: join(root, "validator.log"),
    };
    writeFileSync(env.VALIDATOR_TRACE, "", { mode: 0o600 });
    preserved = [];
    for (const name of ["core", "mcp", "cli"]) {
      const directory = join(root, "packages", name);
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      for (const suffix of ["", ".bak"]) {
        const path = join(directory, `package.json${suffix}`);
        const bytes = Buffer.from(
          JSON.stringify({
            name: `synthetic-${name}`,
            version: "0.2.1",
            suffix,
            dependencies: { core: "workspace:*" },
          }),
        );
        writeFileSync(path, bytes, { mode: 0o600 });
        preserved.push({ path, bytes });
      }
    }
    mkdirSync(join(root, "packages/cli/src"), { recursive: true, mode: 0o700 });
    writeFileSync(join(root, "packages/cli/src/index.ts"), 'const VERSION = "0.2.1";\n', {
      mode: 0o600,
    });
    writeFileSync(
      join(root, "packages/mcp/server.json"),
      JSON.stringify({
        version: "0.2.1",
        packages: [{ registryType: "npm", identifier: "synthetic-mcp", version: "0.2.1" }],
      }),
      { mode: 0o600 },
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function run(args: string[]) {
    const result = await runFixture(
      "/bin/bash",
      ["--noprofile", "--norc", script, ...args],
      root,
      env,
    );
    expect(result.error).toBeUndefined();
    expect(result.timedOut).toBe(false);
    expect(result.outputLimitExceeded).toBe(false);
    expect(result.signal).toBeNull();
    expect(readFileSync(trace, "utf8")).toBe("");
    for (const file of preserved) expect(readFileSync(file.path).equals(file.bytes)).toBe(true);
    return {
      ...result,
      output: `${result.stdout}${result.stderr}`,
    };
  }

  const unknownCases = [
    {
      name: "unsupported OTP",
      args: ["--otp=synthetic-otp-output-sentinel"],
      sentinel: "synthetic-otp-output-sentinel",
    },
    {
      name: "generic secret-shaped flag",
      args: ["--unknown=synthetic-password-output-sentinel"],
      sentinel: "synthetic-password-output-sentinel",
    },
    {
      name: "version and yes before unsupported OTP",
      args: ["--version", "0.2.1", "--yes", "--otp=synthetic-known-output-sentinel"],
      sentinel: "synthetic-known-output-sentinel",
    },
    {
      name: "version and short yes before unknown flag",
      args: ["--version", "0.2.1", "-y", "--unknown=synthetic-short-output-sentinel"],
      sentinel: "synthetic-short-output-sentinel",
    },
  ];

  for (const fixture of unknownCases) {
    test(`${fixture.name} refuses safely before any operation`, async () => {
      const result = await run(fixture.args);
      expect(result.status).toBe(1);
      expect(result.output).not.toContain(fixture.sentinel);
      expect(result.output).toContain("unknown argument (try --help)");
    });
  }

  test("help exits successfully before any operation", async () => {
    const result = await run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("Usage: scripts/publish.sh");
    expect(result.output).toContain("--version");
    expect(result.output).toContain("--yes");
  });

  test("known flags followed by short help retain early success", async () => {
    const result = await run(["--version", "0.2.1", "--yes", "-h"]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("Usage: scripts/publish.sh");
  });

  function removeFixtureBackups() {
    for (const name of ["core", "mcp", "cli"]) {
      rmSync(join(root, "packages", name, "package.json.bak"), { recursive: true, force: true });
    }
  }

  function backupSnapshot(path: string) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return null;
    const identity = {
      dev: stat.dev,
      ino: stat.ino,
      mode: stat.mode,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
    if (stat.isSymbolicLink()) return { ...identity, linkTarget: readlinkSync(path) };
    if (stat.isDirectory()) {
      return {
        ...identity,
        retainedBytes: readFileSync(join(path, "retained.txt")).toString("hex"),
      };
    }
    return { ...identity, bytes: readFileSync(path).toString("hex") };
  }

  async function runBackupCase() {
    const result = await runFixture(
      "/bin/bash",
      ["--noprofile", "--norc", script, "--version", "0.2.1", "--yes"],
      root,
      env,
    );
    expect(result.error).toBeUndefined();
    expect(result.timedOut).toBe(false);
    expect(result.outputLimitExceeded).toBe(false);
    expect(result.signal).toBeNull();
    for (const file of preserved.filter((file) => file.path.endsWith("package.json"))) {
      expect(readFileSync(file.path).equals(file.bytes)).toBe(true);
    }
    return { ...result, output: `${result.stdout}${result.stderr}` };
  }

  const backupKinds = ["regular", "directory", "symlink", "dangling symlink"] as const;
  for (const name of ["core", "mcp", "cli"]) {
    for (const kind of backupKinds) {
      test(`pre-existing ${name} ${kind} backup refuses before any operation`, async () => {
        // Only this position has a backup, so an earlier-package check cannot mask it.
        removeFixtureBackups();
        const backup = join(root, "packages", name, "package.json.bak");
        const target = join(root, "backup-target");
        if (kind === "regular") {
          writeFileSync(backup, "synthetic prior backup", { mode: 0o600 });
        } else if (kind === "directory") {
          mkdirSync(backup, { mode: 0o700 });
          writeFileSync(join(backup, "retained.txt"), "synthetic directory payload", {
            mode: 0o600,
          });
        } else {
          if (kind === "symlink")
            writeFileSync(target, "synthetic linked payload", { mode: 0o600 });
          symlinkSync(target, backup);
        }
        for (const other of ["core", "mcp", "cli"].filter((other) => other !== name)) {
          expect(
            lstatSync(join(root, "packages", other, "package.json.bak"), { throwIfNoEntry: false }),
          ).toBeUndefined();
        }
        const before = backupSnapshot(backup);
        const targetBefore = backupSnapshot(target);
        const result = await runBackupCase();
        expect(result.status).toBe(1);
        expect(result.output).toContain("existing package backup; refusing to overwrite");
        expect(readFileSync(trace, "utf8")).toBe("");
        expect(backupSnapshot(backup)).toEqual(before);
        expect(backupSnapshot(target)).toEqual(targetBefore);
      });
    }
  }

  test("all three existing backups remain intact on refusal", async () => {
    const backups = ["core", "mcp", "cli"].map((name) =>
      join(root, "packages", name, "package.json.bak"),
    );
    const before = backups.map(backupSnapshot);
    const result = await runBackupCase();
    expect(result.status).toBe(1);
    expect(result.output).toContain("existing package backup; refusing to overwrite");
    expect(readFileSync(trace, "utf8")).toBe("");
    expect(backups.map(backupSnapshot)).toEqual(before);
  });

  test("without backups a valid version reaches the original inert copy boundary", async () => {
    removeFixtureBackups();
    // A natural first-copy failure has the same final exit on supported Bash versions.
    writeFileSync(
      join(root, "bin", "cp"),
      `#!/bin/bash\nprintf '%s\\n' 'cp' >> "$SCRIPT_FIXTURE_TRACE"\nexit 1\n`,
      { mode: 0o700 },
    );
    const result = await runBackupCase();
    expect(result.status).toBe(1);
    expect(readFileSync(trace, "utf8")).toBe("cp\n");
    expect(result.output).not.toContain("existing package backup; refusing to overwrite");
    for (const name of ["core", "mcp", "cli"]) {
      expect(
        lstatSync(join(root, "packages", name, "package.json.bak"), { throwIfNoEntry: false }),
      ).toBeUndefined();
    }
  });
  function inputs() {
    return [
      ...preserved.map((file) => file.path),
      join(root, "packages/cli/src/index.ts"),
      join(root, "packages/mcp/server.json"),
    ].map((path) => ({ path, snapshot: backupSnapshot(path) }));
  }

  async function refuse(args: string[], message: string, sentinel?: string) {
    const before = inputs();
    const result = await runFixture(
      "/bin/bash",
      ["--noprofile", "--norc", script, ...args],
      root,
      env,
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.outputLimitExceeded).toBe(false);
    expect(result.status).toBe(1);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain(message);
    if (sentinel) expect(output).not.toContain(sentinel);
    if (message === "source version validation failed")
      expect(readFileSync(env.VALIDATOR_TRACE, "utf8")).toBe("read\n");
    expect(readFileSync(trace, "utf8")).toBe("");
    expect(inputs()).toEqual(before);
    return result;
  }

  test("missing operand and closed-input prompt refuse without effects", async () => {
    await refuse(["--version"], "version is required");
    await refuse([], "version is required");
  });

  test("invalid version never reflects its payload", async () => {
    await refuse(
      ["--version", "synthetic-version-secret\n$(not-run)"],
      "invalid version",
      "synthetic-version-secret",
    );
  });

  test("valid mismatched version refuses before any copy", async () => {
    removeFixtureBackups();
    await refuse(["--version", "0.2.2", "--yes"], "source version validation failed");
    expect(readFileSync(env.VALIDATOR_TRACE, "utf8")).toBe("read\n");
  });

  for (const name of ["core", "mcp", "cli"]) {
    for (const invalid of ['{"version":"0.2.2"}', "not-json", '{"version":21}']) {
      test(`${name} manifest refuses invalid source data ${invalid}`, async () => {
        removeFixtureBackups();
        writeFileSync(join(root, "packages", name, "package.json"), invalid);
        await refuse(["--version", "0.2.1"], "source version validation failed");
      });
    }
  }

  for (const descriptor of [
    {
      version: "0.2.2",
      packages: [{ registryType: "npm", identifier: "synthetic-mcp", version: "0.2.1" }],
    },
    {
      version: "0.2.1",
      packages: [{ registryType: "npm", identifier: "synthetic-mcp", version: "0.2.2" }],
    },
    {
      version: "0.2.1",
      packages: [{ registryType: "npm", identifier: "wrong", version: "0.2.1" }],
    },
    {
      version: "0.2.1",
      packages: Array.from({ length: 2 }, () => ({
        registryType: "npm",
        identifier: "synthetic-mcp",
        version: "0.2.1",
      })),
    },
  ]) {
    test(`descriptor mismatch refuses ${JSON.stringify(descriptor)}`, async () => {
      removeFixtureBackups();
      writeFileSync(join(root, "packages/mcp/server.json"), JSON.stringify(descriptor));
      await refuse(["--version", "0.2.1"], "source version validation failed");
    });
  }

  for (const cli of [
    'const VERSION = "0.2.2";',
    '// const VERSION = "0.2.1";',
    'const VERSION = "0.2.1";\nconst VERSION = "0.2.1";',
    "const VERSION = getVersion();",
  ]) {
    test(`CLI source must have one matching literal ${cli}`, async () => {
      removeFixtureBackups();
      writeFileSync(join(root, "packages/cli/src/index.ts"), cli);
      await refuse(["--version", "0.2.1"], "source version validation failed");
    });
  }

  for (const kind of ["missing", "symlink", "directory"]) {
    test(`source reader refuses ${kind} inputs`, async () => {
      removeFixtureBackups();
      const path = join(root, "packages/mcp/server.json");
      rmSync(path);
      if (kind === "directory") mkdirSync(path);
      if (kind === "symlink") symlinkSync(join(root, "packages/core/package.json"), path);
      // Directory snapshot uses its existing retained fixture convention.
      if (kind === "directory") writeFileSync(join(path, "retained.txt"), "retained");
      const before = backupSnapshot(path);
      const result = await runFixture(
        "/bin/bash",
        ["--noprofile", "--norc", script, "--version", "0.2.1"],
        root,
        env,
      );
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.timedOut).toBe(false);
      expect(result.outputLimitExceeded).toBe(false);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("source version validation failed");
      expect(readFileSync(env.VALIDATOR_TRACE, "utf8")).toBe("read\n");
      expect(readFileSync(trace, "utf8")).toBe("");
      expect(backupSnapshot(path)).toEqual(before);
    });
  }

  function cannedGit(tag: string, head: string, fail = false) {
    writeFileSync(
      join(root, "bin/git"),
      `#!/bin/bash
if [[ "$*" == 'rev-parse --verify refs/tags/v0.2.1^{commit}' ]]; then
  ${fail ? "exit 1" : `printf '%s\\n' '${tag}'`}
elif [[ "$*" == 'rev-parse --verify HEAD' ]]; then
  printf '%s\\n' '${head}'
else
  printf 'git\\n' >> "$SCRIPT_FIXTURE_TRACE"; exit 97
fi
`,
      { mode: 0o700 },
    );
  }

  for (const kind of ["version", "commit", "missing"]) {
    test(`selected tag ${kind} mismatch refuses without mutation`, async () => {
      removeFixtureBackups();
      env.GITHUB_REF = kind === "version" ? "refs/tags/v0.2.2" : "refs/tags/v0.2.1";
      cannedGit("tag", "head", kind === "missing");
      await refuse(["--version", "0.2.1"], "selected tag validation failed");
    });
  }

  test("matching selected tag reaches only the inert original copy boundary", async () => {
    removeFixtureBackups();
    env.GITHUB_REF = "refs/tags/v0.2.1";
    cannedGit("same", "same");
    writeFileSync(
      join(root, "bin/cp"),
      '#!/bin/bash\nprintf "cp\\n" >> "$SCRIPT_FIXTURE_TRACE"\nexit 1\n',
      { mode: 0o700 },
    );
    const result = await runBackupCase();
    expect(result.status).toBe(1);
    expect(readFileSync(trace, "utf8")).toBe("cp\n");
    expect(readFileSync(env.VALIDATOR_TRACE, "utf8")).toBe("read\n");
  });

  async function preflight(
    name: string,
    tag: string,
    otp: string,
    ref = "refs/heads/main",
    event = "workflow_dispatch",
  ) {
    const block = workflowBlock(name);
    // Workflow-level RELEASE_TAG: the pushed tag, or the dispatch tag input.
    env.RELEASE_TAG = tag;
    env.RELEASE_INPUT_OTP = otp;
    env.GITHUB_REF = ref;
    env.GITHUB_EVENT_NAME = event;
    env.GITHUB_OUTPUT = join(root, "github-output");
    writeFileSync(env.GITHUB_OUTPUT, "", { mode: 0o600 });
    const before = inputs();
    const result = await runFixture("/bin/bash", ["--noprofile", "--norc", "-c", block], root, env);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.outputLimitExceeded).toBe(false);
    expect(readFileSync(trace, "utf8")).toBe("");
    expect(inputs()).toEqual(before);
    return { ...result, output: `${result.stdout}${result.stderr}` };
  }

  for (const name of [
    "Validate release source before producers",
    "Validate release source before installs",
  ]) {
    for (const otp of ["synthetic-otp-secret", " ", "$(synthetic-otp-secret)"]) {
      test(`${name} refuses nonempty unsupported OTP before subprocesses ${JSON.stringify(otp)}`, async () => {
        const result = await preflight(name, "v0.2.1", otp);
        expect(result.status).toBe(1);
        expect(result.output).toContain("release input/source validation failed");
        expect(result.output).not.toContain(otp.trim() || "OTP");
        expect(readFileSync(env.VALIDATOR_TRACE, "utf8")).toBe("");
        expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("");
      });
    }
    test(`${name} validates dispatched tag source and exports only its version`, async () => {
      cannedGit("same", "same");
      const result = await preflight(name, "v0.2.1", "");
      expect(result.status).toBe(0);
      expect(readFileSync(env.VALIDATOR_TRACE, "utf8")).toBe("read\n");
      expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("version=0.2.1\n");
    });
    test(`${name} refuses absent, malformed and mismatched dispatch tags`, async () => {
      cannedGit("same", "same");
      for (const tag of ["", "vsynthetic-version-secret", "v0.2.2"]) {
        const result = await preflight(name, tag, "");
        expect(result.status).toBe(1);
        expect(result.output).not.toContain("synthetic-version-secret");
        expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("");
      }
    });
    test(`${name} refuses a dispatched tag that is not the checked-out HEAD`, async () => {
      cannedGit("tag", "head");
      const result = await preflight(name, "v0.2.1", "");
      expect(result.status).toBe(1);
      // Source validation ran, so the refusal is the tag/HEAD check.
      expect(readFileSync(env.VALIDATOR_TRACE, "utf8")).toBe("read\n");
      expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("");
    });
    test(`${name} validates actual selected-tag coherence`, async () => {
      cannedGit("same", "same");
      const matching = await preflight(name, "v0.2.1", "", "refs/tags/v0.2.1", "push");
      expect(matching.status).toBe(0);
      const mismatch = await preflight(name, "v0.2.2", "", "refs/tags/v0.2.1", "push");
      expect(mismatch.status).toBe(1);
      expect(readFileSync(env.GITHUB_OUTPUT, "utf8")).toBe("");
    });
  }

  test("actual npm caller quotes one version, supplies no OTP and propagates failure", async () => {
    const block = workflowBlock("Publish @ashlr/stack-core + @ashlr/stack + ashlr-stack-mcp");
    const argv = join(root, "caller-argv");
    writeFileSync(
      join(root, "bin/bash"),
      `#!/bin/bash
printf '%s\\n' "$@" > "${argv}"
exit 29
`,
      { mode: 0o700 },
    );
    env.RELEASE_VERSION = "synthetic version ; $(not-run)";
    const result = await runFixture("/bin/bash", ["--noprofile", "--norc", "-c", block], root, env);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.outputLimitExceeded).toBe(false);
    expect(result.status).toBe(29);
    expect(readFileSync(argv, "utf8").split("\n")).toEqual([
      "scripts/publish.sh",
      "--version",
      env.RELEASE_VERSION,
      "--yes",
      "",
    ]);
    expect(readFileSync(trace, "utf8")).toBe("");
  });
});
