import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
const cli = join(import.meta.dir, "../packages/cli/src/index.ts");
setDefaultTimeout(30_000);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "scan-troubleshooting-"));
  roots.push(root);
  return root;
}

function scan(cwd: string, ...args: string[]) {
  return spawnSync("bun", [cli, "scan", "--json", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

test("a missing relative path fails without creating it and succeeds after correction", () => {
  const cwd = project();
  const result = scan(cwd, "--path", "missing");
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe('Path "missing" does not exist or is not a directory.');
  expect(existsSync(join(cwd, "missing"))).toBe(false);
  const retry = scan(cwd, "--path", ".");
  expect(retry.status).toBe(0);
  expect(retry.stderr).toBe("");
  expect(JSON.parse(retry.stdout)).toEqual({ hits: [] });
});

test("invalid manifest prevents partial results until its JSON is fixed", () => {
  const cwd = project();
  writeFileSync(join(cwd, "package.json"), '{"dependencies": {');
  writeFileSync(join(cwd, "fly.toml"), "");
  const result = scan(cwd, "--path", ".");
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim().endsWith(
    'Invalid JSON in dependency manifest "package.json". Fix it and retry the scan.',
  )).toBe(true);
  expect(existsSync(join(cwd, ".stack.toml"))).toBe(false);
  writeFileSync(join(cwd, "package.json"), "{}");
  const retry = scan(cwd, "--path", ".");
  expect(retry.status).toBe(0);
  expect(retry.stderr).toBe("");
  expect(JSON.parse(retry.stdout).hits.map((hit: { provider: string }) => hit.provider)).toContain(
    "fly",
  );
});

test("an unreadable manifest path reports an error rather than an empty scan", () => {
  const cwd = project();
  mkdirSync(join(cwd, "package.json"));
  const result = scan(cwd, "--path", ".");
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe('Cannot read dependency manifest "package.json".');
});

test("invalid confidence is reported before a missing path and accepts a corrected value", () => {
  const cwd = project();
  const result = scan(cwd, "--path", "missing", "--confidence", "hgih");
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toBe('Unknown confidence "hgih". Use one of: low, medium, high');
  const retry = scan(cwd, "--path", ".", "--confidence", "HIGH");
  expect(retry.status).toBe(0);
  expect(retry.stderr).toBe("");
  expect(JSON.parse(retry.stdout)).toEqual({ hits: [] });
});
