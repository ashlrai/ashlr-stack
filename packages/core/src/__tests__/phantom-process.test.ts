import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { PhantomNotInstalledError } from "../errors.ts";
import { phantomEnv, resolvePhantomBinary } from "../phantom-process.ts";

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
  writeFileSync(path, script);
  chmodSync(path, 0o755);
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
