import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceScript = resolve(import.meta.dir, "../../../../scripts/publish.sh");
const mutatingCommands = ["npm", "node", "git", "cp", "mv"];

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
    };
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
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(args: string[]) {
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", script, ...args], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 1500,
      maxBuffer: 64 * 1024,
    });
    expect(result.error).toBeUndefined();
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
    test(`${fixture.name} refuses safely before any operation`, () => {
      const result = run(fixture.args);
      expect(result.status).toBe(1);
      expect(result.output).not.toContain(fixture.sentinel);
      expect(result.output).toContain("unknown argument (try --help)");
    });
  }

  test("help exits successfully before any operation", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("Usage: scripts/publish.sh");
    expect(result.output).toContain("--version");
    expect(result.output).toContain("--yes");
  });

  test("known flags followed by short help retain early success", () => {
    const result = run(["--version", "0.2.1", "--yes", "-h"]);
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

  function runBackupCase() {
    const result = spawnSync(
      "/bin/bash",
      ["--noprofile", "--norc", script, "--version", "0.2.1", "--yes"],
      {
        cwd: root,
        env,
        encoding: "utf8",
        timeout: 1500,
        maxBuffer: 64 * 1024,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    for (const file of preserved.filter((file) => file.path.endsWith("package.json"))) {
      expect(readFileSync(file.path).equals(file.bytes)).toBe(true);
    }
    return { ...result, output: `${result.stdout}${result.stderr}` };
  }

  const backupKinds = ["regular", "directory", "symlink", "dangling symlink"] as const;
  for (const name of ["core", "mcp", "cli"]) {
    for (const kind of backupKinds) {
      test(`pre-existing ${name} ${kind} backup refuses before any operation`, () => {
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
        const result = runBackupCase();
        expect(result.status).toBe(1);
        expect(result.output).toContain("existing package backup; refusing to overwrite");
        expect(readFileSync(trace, "utf8")).toBe("");
        expect(backupSnapshot(backup)).toEqual(before);
        expect(backupSnapshot(target)).toEqual(targetBefore);
      });
    }
  }

  test("all three existing backups remain intact on refusal", () => {
    const backups = ["core", "mcp", "cli"].map((name) =>
      join(root, "packages", name, "package.json.bak"),
    );
    const before = backups.map(backupSnapshot);
    const result = runBackupCase();
    expect(result.status).toBe(1);
    expect(result.output).toContain("existing package backup; refusing to overwrite");
    expect(readFileSync(trace, "utf8")).toBe("");
    expect(backups.map(backupSnapshot)).toEqual(before);
  });

  test("without backups a valid version reaches the original inert copy boundary", () => {
    removeFixtureBackups();
    // A natural first-copy failure has the same final exit on supported Bash versions.
    writeFileSync(
      join(root, "bin", "cp"),
      `#!/bin/bash\nprintf '%s\\n' 'cp' >> "$SCRIPT_FIXTURE_TRACE"\nexit 1\n`,
      { mode: 0o700 },
    );
    const result = runBackupCase();
    expect(result.status).toBe(1);
    expect(readFileSync(trace, "utf8")).toBe("cp\n");
    expect(result.output).not.toContain("existing package backup; refusing to overwrite");
    for (const name of ["core", "mcp", "cli"]) {
      expect(
        lstatSync(join(root, "packages", name, "package.json.bak"), { throwIfNoEntry: false }),
      ).toBeUndefined();
    }
  });
});
