import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

describe("stack sync", () => {
  it("rejects an unsupported platform before looking for Phantom", () => {
    // An empty PATH means no `phantom` binary: the platform error must come first.
    const emptyBin = mkdtempSync(join(tmpdir(), "stack-sync-path-"));
    try {
      const result = spawnSync(process.execPath, [CLI_ENTRY, "sync", "--platform", "heroku"], {
        encoding: "utf8",
        env: { HOME: process.env.HOME ?? "", PATH: emptyBin, NO_COLOR: "1", CI: "1" },
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      expect(result.status).toBe(1);
      expect(output).toContain('Unsupported platform "heroku"');
      expect(output).not.toMatch(/phantom.*(not found|install)/i);
    } finally {
      rmSync(emptyBin, { recursive: true, force: true });
    }
  });
});
