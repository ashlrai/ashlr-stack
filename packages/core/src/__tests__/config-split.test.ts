import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FILENAME,
  LOCAL_FILENAME,
  emptyConfig,
  readConfig,
  writeConfig,
} from "../config.ts";

describe("committed + local config split", () => {
  let cwd: string;
  let previousRegistryDir: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "stack-split-"));
    // Isolate the registry side-effect so tests don't pollute ~/.stack.
    previousRegistryDir = process.env.STACK_REGISTRY_DIR;
    process.env.STACK_REGISTRY_DIR = mkdtempSync(join(tmpdir(), "stack-registry-"));
  });

  afterEach(() => {
    if (previousRegistryDir === undefined) delete process.env.STACK_REGISTRY_DIR;
    else process.env.STACK_REGISTRY_DIR = previousRegistryDir;
  });

  test("writeConfig leaves .stack.toml free of instance data", async () => {
    const config = emptyConfig("my-template");
    config.services.supabase = {
      provider: "supabase",
      resource_id: "abcd1234",
      region: "us-east-1",
      secrets: ["SUPABASE_URL", "SUPABASE_ANON_KEY"],
      mcp: "supabase",
      meta: { organization_id: "org-1" },
      created_at: "2026-04-17T05:00:00Z",
      created_by: "test",
    };
    await writeConfig(config, cwd);

    const shape = readFileSync(join(cwd, CONFIG_FILENAME), "utf-8");
    expect(shape).not.toContain("stk_"); // project_id shouldn't leak
    expect(shape).not.toContain("abcd1234"); // resource_id shouldn't leak
    expect(shape).not.toContain("org-1"); // meta shouldn't leak
    expect(shape).not.toContain("2026-04-17T05:00:00Z"); // timestamps shouldn't leak
    expect(shape).toContain("provider"); // shape fields remain
    expect(shape).toContain("SUPABASE_ANON_KEY");

    const instance = readFileSync(join(cwd, LOCAL_FILENAME), "utf-8");
    expect(instance).toContain(config.stack.project_id);
    expect(instance).toContain("abcd1234");
    expect(instance).toContain("2026-04-17T05:00:00Z");
  });

  test("readConfig merges the two files back into a single StackConfig", async () => {
    const original = emptyConfig("my-template");
    original.services.supabase = {
      provider: "supabase",
      resource_id: "merge-me",
      secrets: ["FOO"],
      mcp: "supabase",
      created_at: "2026-04-17T05:00:00Z",
    };
    await writeConfig(original, cwd);
    const roundtrip = await readConfig(cwd);
    expect(roundtrip.stack.project_id).toBe(original.stack.project_id);
    expect(roundtrip.services.supabase.resource_id).toBe("merge-me");
    expect(roundtrip.services.supabase.secrets).toEqual(["FOO"]);
  });

  test("writeConfig auto-appends .stack.local.toml to .gitignore", async () => {
    await writeConfig(emptyConfig(), cwd);
    const gitignore = readFileSync(join(cwd, ".gitignore"), "utf-8");
    expect(gitignore).toContain(LOCAL_FILENAME);
  });

  test("writeConfig does not duplicate an existing .gitignore entry", async () => {
    writeFileSync(join(cwd, ".gitignore"), `node_modules\n${LOCAL_FILENAME}\n`);
    await writeConfig(emptyConfig(), cwd);
    const gitignore = readFileSync(join(cwd, ".gitignore"), "utf-8");
    const occurrences = gitignore.split(LOCAL_FILENAME).length - 1;
    expect(occurrences).toBe(1);
  });

  test("legacy single-file .stack.toml reads back correctly (back-compat)", async () => {
    const legacy = `
[stack]
version = "1"
project_id = "stk_legacy"
template = "nextjs-supabase-posthog"

[services.supabase]
provider = "supabase"
resource_id = "legacy-id"
secrets = ["X"]
mcp = "supabase"
created_at = "2026-04-17T00:00:00Z"
created_by = "legacy"

[[environments]]
name = "dev"
default = true
`.trim();
    writeFileSync(join(cwd, CONFIG_FILENAME), legacy);
    // No .stack.local.toml exists — should still merge via legacy path.
    const config = await readConfig(cwd);
    expect(config.stack.project_id).toBe("stk_legacy");
    expect(config.services.supabase.resource_id).toBe("legacy-id");
    expect(config.services.supabase.secrets).toEqual(["X"]);
    expect(existsSync(join(cwd, LOCAL_FILENAME))).toBe(false);
  });

  test("re-writing a legacy config migrates it to the split format", async () => {
    const legacy = `
[stack]
version = "1"
project_id = "stk_migrate"

[services.openai]
provider = "openai"
secrets = ["OPENAI_API_KEY"]
created_at = "2026-04-17T00:00:00Z"

[[environments]]
name = "dev"
default = true
`.trim();
    writeFileSync(join(cwd, CONFIG_FILENAME), legacy);
    const config = await readConfig(cwd);
    await writeConfig(config, cwd);
    expect(existsSync(join(cwd, LOCAL_FILENAME))).toBe(true);
    const shape = readFileSync(join(cwd, CONFIG_FILENAME), "utf-8");
    expect(shape).not.toContain("stk_migrate");
    expect(shape).toContain("OPENAI_API_KEY");
  });
});
