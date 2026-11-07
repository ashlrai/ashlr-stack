import { afterAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = new URL("../index.ts", import.meta.url).pathname;
const map = readFileSync(new URL("../../../../docs/cli-command-map.md", import.meta.url), "utf8");
const home = mkdtempSync(join(tmpdir(), "stack-command-map-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

function cli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: home,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        STACK_REGISTRY_DIR: join(home, "registry"),
        STACK_NO_UPDATE_CHECK: "1",
        STACK_TELEMETRY: "0",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

const rows = [...map.matchAll(/^\| `([\w-]+)` \|[^\n]*?\| `stack ([^`]+)` \| ([^\n]+) \|$/gm)].map(
  (match) => ({ name: match[1], example: match[2], state: match[3] }),
);

test("command map covers root help and example options are in current help", async () => {
  const root = await cli(["--help"]);
  expect(root.code).toBe(0);
  const usage = root.stdout.match(/^USAGE stack \[OPTIONS\] (.+)$/m);
  expect(usage).not.toBeNull();
  const names = usage?.[1].split("|") ?? [];
  expect(rows.map((row) => row.name)).toEqual(names);
  expect(new Set(rows.map((row) => row.name)).size).toBe(names.length);

  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        expect(row.state.length).toBeGreaterThan(3);
        const args = row.example.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
        expect(args[0]).toBe(row.name);
        const sub = ["env", "telemetry", "templates", "projects"].includes(row.name)
          ? args[1]
          : undefined;
        const result = await cli([row.name, ...(sub ? [sub] : []), "--help"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain(
          sub ? `USAGE ${row.name} ${sub}` : `USAGE stack ${row.name}`,
        );
        for (const flag of args.filter((arg) => /^--[\w-]+$/.test(arg))) {
          expect(result.stdout).toContain(flag);
        }
      }
    }),
  );
}, 90_000);

test("representative documented examples run in an isolated project", async () => {
  const init = await cli(["init", "--noInteractive"]);
  expect(init.code).toBe(0);
  expect(existsSync(join(home, ".stack.toml"))).toBe(true);
  for (const args of [
    ["scan", "--json"],
    ["list", "--json"],
    ["deps", "--json"],
    ["fleet-act", "pause", "--lane", "codex-personal", "--json"],
    ["templates", "list", "--json"],
    ["providers", "--json"],
    ["projects", "list", "--json"],
  ]) {
    const result = await cli(args);
    expect(result.code).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  }
  const completion = await cli(["completion", "zsh"]);
  expect(completion.code).toBe(0);
  expect(completion.stdout).toContain("stack");
  const ci = await cli(["ci", "--json"]);
  expect(ci.code).not.toBe(0);
  expect(JSON.parse(ci.stdout)).toHaveProperty("error");
}, 60_000);
