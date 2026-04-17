import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FILENAME,
  emptyConfig,
  hasConfig,
  readConfig,
  resolveConfigPath,
  writeConfig,
} from "../config.ts";

function freshCwd(): string {
  return mkdtempSync(join(tmpdir(), "stack-test-"));
}

describe("config", () => {
  let previousRegistryDir: string | undefined;

  beforeEach(() => {
    previousRegistryDir = process.env.STACK_REGISTRY_DIR;
    process.env.STACK_REGISTRY_DIR = mkdtempSync(join(tmpdir(), "stack-cfg-reg-"));
  });

  afterEach(() => {
    if (previousRegistryDir === undefined) delete process.env.STACK_REGISTRY_DIR;
    else process.env.STACK_REGISTRY_DIR = previousRegistryDir;
  });

  test("emptyConfig produces a fresh project id and default dev env", () => {
    const config = emptyConfig();
    expect(config.stack.version).toBe("1");
    expect(config.stack.project_id).toMatch(/^stk_[a-f0-9]{12}$/);
    expect(config.environments).toEqual([{ name: "dev", default: true }]);
    expect(config.services).toEqual({});
  });

  test("writeConfig → readConfig round-trips", async () => {
    const cwd = freshCwd();
    const original = emptyConfig("nextjs-supabase-posthog");
    original.services.supabase = {
      provider: "supabase",
      resource_id: "abcd1234",
      region: "us-east-1",
      secrets: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
      mcp: "supabase",
      created_at: "2026-04-17T05:00:00Z",
      created_by: "test",
    };
    await writeConfig(original, cwd);

    expect(hasConfig(cwd)).toBe(true);
    expect(resolveConfigPath(cwd).endsWith(CONFIG_FILENAME)).toBe(true);

    const roundTripped = await readConfig(cwd);
    expect(roundTripped.stack.project_id).toBe(original.stack.project_id);
    expect(roundTripped.stack.template).toBe("nextjs-supabase-posthog");
    expect(roundTripped.services.supabase).toEqual(original.services.supabase);
  });

  test("readConfig throws ConfigNotFoundError when file is missing", async () => {
    const cwd = freshCwd();
    await expect(readConfig(cwd)).rejects.toThrow(/No .stack.toml at/);
  });
});
