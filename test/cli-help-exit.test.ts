import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../packages/cli/src/index.ts", import.meta.url));

test("--help exits successfully and prints usage", () => {
  const home = mkdtempSync(join(tmpdir(), "stack-cli-help-"));
  try {
    const result = Bun.spawnSync([process.execPath, entry, "--help"], {
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

    expect(result.signalCode).toBeUndefined();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toMatch(/usage\s+`?stack\b/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 25_000);
