import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PhantomNotInstalledError } from "../errors.ts";
import { phantomProcess } from "../phantom.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "phantom-process-"));
  dirs.push(dir);
  return dir;
}

test("resolves an absolute executable and passes exactly the environment allowlist", () => {
  const dir = fixture();
  const file = join(dir, process.platform === "win32" ? "phantom.exe" : "phantom");
  writeFileSync(file, "");
  chmodSync(file, 0o755);
  const allowed = {
    HOME: dir,
    USERPROFILE: dir,
    SYSTEMROOT: dir,
    SystemRoot: dir,
    LANG: "C",
    LC_ALL: "C",
    LC_CTYPE: "C",
    TMPDIR: dir,
    TEMP: dir,
    TMP: dir,
    TERM: "dumb",
    NO_COLOR: "1",
    LOCUS_HOME: dir,
    LOCUS_SESSION_ID: "test-session",
  };
  const result = phantomProcess({
    ...allowed,
    PATH: ["", ".", "relative", dir].join(delimiter),
    Path: dir,
    AWS_SECRET_ACCESS_KEY: "synthetic",
    NODE_OPTIONS: "--require=untrusted",
    BUN_OPTIONS: "untrusted",
    LD_PRELOAD: "untrusted",
    DYLD_INSERT_LIBRARIES: "untrusted",
    ARBITRARY: "synthetic",
  });
  expect(result).toEqual({ file, env: { ...allowed, PATH: dir, Path: dir } });
});

test("refuses missing, relative and non-executable candidates without PATH fallback", () => {
  const dir = fixture();
  expect(() => phantomProcess({ PATH: ["", ".", "relative", dir].join(delimiter) })).toThrow(
    PhantomNotInstalledError,
  );
  if (process.platform !== "win32") {
    writeFileSync(join(dir, "phantom"), "");
    chmodSync(join(dir, "phantom"), 0o644);
    expect(() => phantomProcess({ PATH: dir })).toThrow(PhantomNotInstalledError);
  }
});

test.skipIf(process.platform === "win32")(
  "exec uses the resolved file with a filtered environment",
  () => {
    const dir = fixture();
    const file = join(dir, "phantom");
    writeFileSync(
      file,
      '#!/bin/sh\n[ -z "${STACK_EXEC_TEST_PRIVATE+x}" ] || exit 9\nprintf "%s" "$0"\n',
    );
    chmodSync(file, 0o755);
    const result = spawnSync(
      process.execPath,
      [
        "--eval",
        `import { exec } from ${JSON.stringify(new URL("../phantom.ts", import.meta.url).href)};
const result = await exec(["--version"]);
process.stdout.write(JSON.stringify({ code: result.code, stdout: result.stdout }));`,
      ],
      { encoding: "utf8", env: { PATH: dir, HOME: dir, STACK_EXEC_TEST_PRIVATE: "synthetic" } },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ code: 0, stdout: file });
  },
);
