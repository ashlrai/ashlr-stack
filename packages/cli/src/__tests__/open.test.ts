import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openerFor } from "../commands/open.ts";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stack-open-"));
  writeFileSync(
    join(dir, ".stack.toml"),
    `[stack]\nversion = "1"\n\n[services.vercel]\nprovider = "vercel"\nresource_id = "prj_test"\nsecrets = ["VERCEL_TOKEN"]\n\n[[environments]]\nname = "dev"\ndefault = true\n`,
  );
  writeFileSync(join(dir, ".stack.local.toml"), `[stack]\nproject_id = "stk_test01"\n`);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("stack open", () => {
  test("prints the URL to open by hand when no opener is on PATH", () => {
    // PATH is an empty directory, so xdg-open/open cannot be found. An empty
    // PATH string is not enough: spawn then falls back to the system default
    // search path, where CI runners do have xdg-open.
    const emptyBin = join(dir, "empty-bin");
    mkdirSync(emptyBin);
    const result = spawnSync(process.execPath, [CLI_ENTRY, "open", "vercel"], {
      encoding: "utf8",
      cwd: dir,
      env: { ...process.env, PATH: emptyBin, NO_COLOR: "1", CI: "1", STACK_TELEMETRY: "0" },
    });
    const out = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("https://vercel.com/");
    expect(result.stdout).toContain("open it");
    expect(out).not.toContain("Executable not found");
    expect(out).not.toMatch(/\n\s+at /);
  });

  test("uses a real program on Windows, not the cmd builtin `start`", () => {
    const [cmd, args] = openerFor("win32", "https://example.com/?a=1&b=2");
    expect(cmd).not.toBe("start");
    expect(args).toContain("https://example.com/?a=1&b=2");
    expect(openerFor("darwin", "https://x.test")).toEqual(["open", ["https://x.test"]]);
    expect(openerFor("linux", "https://x.test")).toEqual(["xdg-open", ["https://x.test"]]);
  });
});
