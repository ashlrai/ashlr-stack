import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { PhantomNotInstalledError, StackError } from "../errors.ts";
import {
  phantomEnv,
  phantomSpawnTarget,
  resolvePhantomBinary,
  windowsBatchCommandLine,
} from "../phantom-process.ts";

const dirs: string[] = [];
function tmp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "phantom-process-")));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const name = process.platform === "win32" ? "phantom.exe" : "phantom";
function binary(dir: string, script = "#!/bin/sh\nexit 0\n"): string {
  const path = join(dir, name);
  // Sandboxed runners and macOS Gatekeeper's provenance policy refuse to
  // exec an extensionless file written by a non-platform process, while a
  // `*.sh` target passes the check: point `phantom` at a `phantom.sh` shim.
  const real = join(dir, `${name}.sh`);
  writeFileSync(real, script);
  chmodSync(real, 0o755);
  try {
    symlinkSync(real, path);
  } catch {
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }
  return path;
}

describe("Phantom process boundary", () => {
  test("environment has an exact allowlist, including only the explicit vault unlock input", () => {
    const pathEntry = join(tmpdir(), "phantom-env-path");
    const allowed = {
      PATH: pathEntry,
      HOME: "/home/test",
      USER: "test",
      USERPROFILE: "C:\\test",
      SystemRoot: "C:\\Windows",
      APPDATA: "/app",
      LOCALAPPDATA: "/local",
      PATHEXT: ".EXE",
      XDG_CONFIG_HOME: "/config",
      XDG_DATA_HOME: "/data",
      XDG_STATE_HOME: "/state",
      XDG_RUNTIME_DIR: "/runtime",
      TMPDIR: "/tmp",
      TEMP: "/temp",
      TMP: "/tmp",
      LANG: "C",
      LC_ALL: "C",
      LC_CTYPE: "C",
      TERM: "dumb",
      NO_COLOR: "",
      PHANTOM_VAULT_PASSPHRASE: "synthetic-test-input",
    };
    expect(
      phantomEnv({
        ...allowed,
        OPENAI_API_KEY: "synthetic",
        GITHUB_TOKEN: "synthetic",
        NODE_OPTIONS: "--inspect",
        LD_PRELOAD: "/untrusted",
        DYLD_INSERT_LIBRARIES: "/untrusted",
        BASH_ENV: "/untrusted",
        PHANTOM_UNKNOWN: "synthetic",
        LOCUS_CONTROL_CAPABILITY: "synthetic",
      }),
    ).toEqual(allowed);
    expect(phantomEnv({ HOME: undefined })).toEqual({});
  });

  test("PATH is normalized: empty entries dropped, relative entries resolved in the caller's cwd", () => {
    const abs = join(tmpdir(), "phantom-env-abs");
    expect(phantomEnv({ PATH: `${delimiter}rel${delimiter}${abs}${delimiter}` })).toEqual({
      PATH: `${resolve("rel")}${delimiter}${abs}`,
    });
    expect(phantomEnv({ PATH: delimiter })).toEqual({ PATH: "" });
  });

  test("a cmd shim is a Windows phantom and is ignored on other systems", () => {
    const bin = tmp();
    const cmd = join(bin, "phantom.cmd");
    writeFileSync(cmd, "@echo off\r\nexit /b 0\r\n");
    if (process.platform === "win32") {
      expect(resolvePhantomBinary({ PATH: bin })).toBe(cmd);
      const exe = binary(bin);
      expect(resolvePhantomBinary({ PATH: bin })).toBe(exe);
    } else {
      expect(() => resolvePhantomBinary({ PATH: bin })).toThrow(PhantomNotInstalledError);
    }
  });

  test("a cmd shim quotes secret names and paths instead of handing them to the shell", () => {
    const script = "C:\\Tools\\phantom.cmd";
    const secret = "OPENAI_API_KEY";
    const injection = "value & whoami > injected.txt";
    const percent = "%PATH%";
    const payload = "%CMDCMDLINE:~-1%&calc.exe";
    const quoted = 'say "hi"';
    const path = "C:\\Program Files\\stack";
    const line = windowsBatchCommandLine(script, [
      secret,
      injection,
      percent,
      payload,
      quoted,
      path,
      "",
    ]);
    expect(line.startsWith('cmd.exe /e:ON /v:OFF /d /c "')).toBe(true);
    expect(line.endsWith('"')).toBe(true);
    expect(line).toContain(`"${script}"`);
    expect(line).toContain(` ${secret} `);
    expect(line).toContain(`"${injection}"`);
    expect(line).toContain('"%%cd:~,%PATH%%cd:~,%"');
    expect(line).toContain('"%%cd:~,%CMDCMDLINE:~-1%%cd:~,%&calc.exe"');
    expect(line).toContain('"say ""hi"""');
    expect(line).toContain(`"${path}"`);
    expect(line.endsWith(' """')).toBe(true);
    expect(line.includes("shell")).toBe(false);
    const target = phantomSpawnTarget(script, [injection], "win32");
    expect(target.windowsVerbatimArguments).toBe(true);
    expect(target.file === "cmd.exe" || target.file.endsWith("\\cmd.exe")).toBe(true);
    expect(target.args.slice(0, 4)).toEqual(["/e:ON", "/v:OFF", "/d", "/c"]);
    expect(target.args[4]).toBe(
      windowsBatchCommandLine(script, [injection]).slice("cmd.exe /e:ON /v:OFF /d /c ".length),
    );
    expect(phantomSpawnTarget("C:\\Tools\\phantom.exe", [secret], "win32")).toEqual({
      file: "C:\\Tools\\phantom.exe",
      args: [secret],
    });
    expect(() => windowsBatchCommandLine(script, ["line\nbreak"])).toThrow(StackError);
    expect(() => windowsBatchCommandLine("C:\\bad%name.cmd", [])).toThrow(StackError);
  });

  test.skipIf(process.platform !== "win32")(
    "cmd.exe keeps metacharacters inside one phantom argument",
    () => {
      const dir = tmp();
      const marker = join(dir, "argv.json");
      const record = join(dir, "record.mjs");
      writeFileSync(
        record,
        'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));\n',
      );
      const cmd = join(dir, "phantom.cmd");
      writeFileSync(
        cmd,
        `@echo off\r\n"${process.execPath}" "${record}" "${marker}" "%~1" "%~2" "%~3"\r\n`,
      );
      const args = ["OPENAI_API_KEY", "value & whoami > injected.txt", "%PATH%"];
      const spec = phantomSpawnTarget(cmd, args, "win32");
      const result = spawnSync(spec.file, spec.args, {
        cwd: dir,
        encoding: "utf8",
        windowsVerbatimArguments: true,
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual(args);
    },
  );

  test("resolves the first executable to an absolute path, including relative PATH entries", () => {
    const root = tmp();
    const bin = join(root, "bin");
    mkdirSync(bin);
    const expected = binary(bin);
    expect(resolvePhantomBinary({ PATH: `missing${delimiter}bin` }, root)).toBe(expected);
    expect(resolvePhantomBinary({ PATH: `${bin}${delimiter}${tmp()}` })).toBe(expected);
  });

  test("missing PATH, empty entries and directories fail closed", () => {
    const root = tmp();
    binary(root);
    expect(() => resolvePhantomBinary({}, root)).toThrow(PhantomNotInstalledError);
    expect(() => resolvePhantomBinary({ PATH: delimiter }, root)).toThrow(PhantomNotInstalledError);
    const bin = tmp();
    mkdirSync(join(bin, name));
    expect(() => resolvePhantomBinary({ PATH: bin })).toThrow(PhantomNotInstalledError);
  });

  test.skipIf(process.platform === "win32")(
    "non-executable files do not shadow an installation",
    () => {
      const first = tmp();
      chmodSync(binary(first), 0o644);
      const second = tmp();
      const expected = binary(second);
      expect(resolvePhantomBinary({ PATH: `${first}${delimiter}${second}` })).toBe(expected);
    },
  );

  test.skipIf(process.platform === "win32")(
    "exec uses the resolved path across cwd changes and filters the actual child env",
    () => {
      const root = tmp();
      const bin = join(root, "bin");
      mkdirSync(bin);
      const childCwd = tmp();
      const expected = binary(
        bin,
        `#!/bin/sh
[ -z "\${OPENAI_API_KEY+x}" ] || exit 21
[ -z "\${BASH_ENV+x}" ] || exit 22
[ "$HOME" = "$1" ] || exit 23
printf '%s' "$0"
`,
      );
      const modulePath = new URL("../phantom.ts", import.meta.url).href;
      const script = `import { exec } from ${JSON.stringify(modulePath)};
const r = await exec([${JSON.stringify(root)}], { cwd: ${JSON.stringify(childCwd)} });
process.stdout.write(r.stdout);`;
      const r = spawnSync(process.execPath, ["--eval", script], {
        cwd: root,
        encoding: "utf8",
        env: { HOME: root, PATH: "bin", OPENAI_API_KEY: "synthetic", BASH_ENV: "/nonexistent" },
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(expected);
    },
  );
});
