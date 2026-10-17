import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "@ashlr/stack-core";
import { type Harness, setupFakePhantom } from "../../../core/src/__tests__/_harness.ts";
import { rollbackProviders } from "../lib/provision-loop.ts";

/**
 * `stack apply` / `stack init --template` roll back the providers that
 * succeeded when another one failed (automatically without a terminal).
 * Rollback only forgets local state: it must name each upstream resource it
 * leaves running, since the dropped .stack.toml entry was the only local
 * record of its id and a re-run would otherwise create a second one.
 */

let h: Harness;
let dir: string;
let prevCwd: string;

beforeEach(() => {
  h = setupFakePhantom({ SUPABASE_URL: "https://x.supabase.co" }, { initialized: true });
  dir = mkdtempSync(join(tmpdir(), "stack-rollback-"));
  writeFileSync(
    join(dir, ".stack.toml"),
    `[stack]\nversion = "1"\n\n[services.supabase]\nprovider = "supabase"\nsecrets = ["SUPABASE_URL"]\n\n[services.openai]\nprovider = "openai"\nsecrets = ["OPENAI_API_KEY"]\n`,
  );
  writeFileSync(
    join(dir, ".stack.local.toml"),
    `[stack]\nproject_id = "stk_test01"\n\n[services.supabase]\nresource_id = "proj_live_123"\ncreated_at = "2026-10-17T00:00:00.000Z"\n`,
  );
  prevCwd = process.cwd();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(prevCwd);
  h.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe("rollbackProviders", () => {
  it("drops the entries and names the upstream resources it did not delete", async () => {
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    try {
      await rollbackProviders(["supabase"]);
    } finally {
      log.mockRestore();
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI colors
    const out = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(out).toContain("upstream resource proj_live_123 was not deleted");
    expect(out).toContain("stack add supabase --use proj_live_123");
    const config = await readConfig();
    expect(config.services.supabase).toBeUndefined();
    expect(config.services.openai).toBeDefined();
  });
});
