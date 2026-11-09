import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../packages/cli/src/index.ts", import.meta.url));

function runHelp(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "stack-cli-help-"));
  try {
    return Bun.spawnSync([process.execPath, entry, ...args], {
      cwd: home,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
      env: {
        HOME: home,
        PATH: process.env.PATH ?? "",
        NO_COLOR: "1",
        STACK_NO_UPDATE_CHECK: "1",
        STACK_TELEMETRY: "0",
        DO_NOT_TRACK: "1",
        CI: "1",
      },
    });

  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("--help exits successfully and prints usage", () => {
  const result = runHelp(["--help"]);
  expect(result.signalCode).toBeUndefined();
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toMatch(/usage\s+`?stack\b/i);
}, 25_000);

test("help for an unknown command fails with a useful diagnostic", () => {
  for (const args of [["imaginary-command", "--help"], ["templates", "imaginary-command", "-h"]]) {
    const result = runHelp(args);
    expect(result.signalCode).toBeUndefined();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toMatch(/unknown command.*imaginary-command/i);
    expect(result.stderr.toString()).toContain(args[0] === "templates" ? "stack templates --help" : "stack --help");
  }
}, 50_000);

test("repeated help invocations exit successfully with identical output", () => {
  for (const args of [["--help"], ["templates", "list", "--help"]]) {
    const first = runHelp(args);
    const second = runHelp(args);
    for (const result of [first, second]) {
      expect(result.signalCode).toBeUndefined();
      expect(result.exitCode).toBe(0);
    }
    expect(first.stdout.toString()).not.toBe("");
    expect(second.stdout.toString()).toBe(first.stdout.toString());
    expect(second.stderr.toString()).toBe(first.stderr.toString());
  }
}, 100_000);

test("help for a known command succeeds", () => {
  const result = runHelp(["templates", "list", "--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toMatch(/usage/i);
}, 25_000);
