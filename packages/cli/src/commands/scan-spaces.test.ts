import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
let root: string;
let project: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "stack scan "));
  project = join(root, "projects with spaces", "my app");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.45.0" } }),
  );
  writeFileSync(join(project, "fly.toml"), "app = 'my-app'\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function runScan(args: string[], cwd: string) {
  return spawnSync("bun", [cli, "scan", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1", NO_COLOR: "1" },
    timeout: 15_000,
  });
}

describe("stack scan with spaces in the project path", () => {
  test.each(["absolute", "relative"])("reads fixture signals using the %s --path", (kind) => {
    const path = kind === "absolute" ? project : join("projects with spaces", "my app");
    const result = runScan(["--json", "--path", path], root);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      hits: [
        { provider: "fly", confidence: "high", sources: ["fly.toml"] },
        {
          provider: "supabase",
          confidence: "high",
          sources: ["package.json:@supabase/supabase-js"],
        },
      ],
    });
    expect(existsSync(join(project, ".stack.toml"))).toBe(false);
  });

  test("reports results when the working directory contains spaces", () => {
    const result = runScan([], project);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("fly.toml");
    expect(result.stdout).toContain("package.json:@supabase/supabase-js");
    expect(result.stdout).toContain("stack add fly");
    expect(result.stdout).toContain("stack add supabase");
    expect(result.stdout).toContain("nothing written");
    expect(existsSync(join(project, ".stack.toml"))).toBe(false);
  });
});
