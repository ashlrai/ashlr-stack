import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("an unknown command exits unsuccessfully and identifies the command", () => {
  const cwd = mkdtempSync(join(tmpdir(), "stack-unknown-command-"));
  try {
    const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
    const result = spawnSync("bun", [entry, "definitely-not-a-stack-command"], {
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: cwd,
        NO_COLOR: "1",
        STACK_NO_UPDATE_CHECK: "1",
        STACK_TELEMETRY: "0",
      },
      timeout: 20_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command definitely-not-a-stack-command");
    expect(`${result.stdout}${result.stderr}`).toContain("USAGE");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 25_000);
