import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_FILENAME,
  LOCAL_FILENAME,
  emptyConfig,
  hasConfig,
  readConfig,
  resolveConfigPath,
  writeConfig,
} from "../config.ts";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-test-"));
  scratch.push(dir);
  return dir;
}

describe("config", () => {
  let previousRegistryDir: string | undefined;

  beforeEach(() => {
    previousRegistryDir = process.env.STACK_REGISTRY_DIR;
    process.env.STACK_REGISTRY_DIR = freshCwd();
  });

  afterEach(() => {
    if (previousRegistryDir === undefined)
      Reflect.deleteProperty(process.env, "STACK_REGISTRY_DIR");
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
  test.each([".stack.toml", ".stack.local.toml"])(
    "rejects malformed %s without rewriting files",
    async (file) => {
      const cwd = freshCwd();
      writeFileSync(join(cwd, CONFIG_FILENAME), '[stack]\nversion = "1"');
      writeFileSync(join(cwd, file), "[broken");
      await expect(readConfig(cwd)).rejects.toThrow();
      expect(readFileSync(join(cwd, file), "utf-8")).toBe("[broken");
    },
  );

  test.each(["", "node_modules/", "node_modules/\n", " .stack.local.toml \r\n"])(
    "gitignore update preserves existing content %j and is idempotent",
    async (initial) => {
      const cwd = freshCwd();
      writeFileSync(join(cwd, ".gitignore"), initial);
      const config = emptyConfig();
      await writeConfig(config, cwd);
      const first = readFileSync(join(cwd, ".gitignore"), "utf-8");
      expect(first.startsWith(initial)).toBe(true);
      expect(
        first.split(/\r?\n/).filter((line) => line.trim() === ".stack.local.toml"),
      ).toHaveLength(1);
      await writeConfig(config, cwd);
      expect(readFileSync(join(cwd, ".gitignore"), "utf-8")).toBe(first);
    },
  );

  test("empty shape supplies defaults without creating local files", async () => {
    const cwd = freshCwd();
    writeFileSync(join(cwd, CONFIG_FILENAME), "");
    const config = await readConfig(cwd);
    expect(config.stack.version).toBe("1");
    expect(config.stack.project_id).toMatch(/^stk_[a-f0-9]{12}$/);
    expect(config.services).toEqual({});
    expect(readFileSync(join(cwd, CONFIG_FILENAME), "utf-8")).toBe("");
    expect(existsSync(join(cwd, LOCAL_FILENAME))).toBe(false);
    expect(existsSync(join(cwd, ".gitignore"))).toBe(false);
    expect(config.environments).toEqual([{ name: "dev", default: true }]);
  });

  test("empty shape keeps the local project id but does not add local-only services", async () => {
    const cwd = freshCwd();
    const local =
      '[stack]\nproject_id = "stk_fixture"\n[services.orphan]\nresource_id = "fixture-resource"\n';
    writeFileSync(join(cwd, CONFIG_FILENAME), "");
    writeFileSync(join(cwd, LOCAL_FILENAME), local);

    expect(await readConfig(cwd)).toEqual({
      stack: { version: "1", project_id: "stk_fixture" },
      services: {},
      environments: [{ name: "dev", default: true }],
    });
    expect(readFileSync(join(cwd, CONFIG_FILENAME), "utf-8")).toBe("");
    expect(readFileSync(join(cwd, LOCAL_FILENAME), "utf-8")).toBe(local);
    expect(existsSync(join(cwd, ".gitignore"))).toBe(false);
  });
  test.each(['created_at = "2026-01-01T00:00:00Z"', 'resource_id = "resource-1"'])(
    "legacy service marker %s normalizes optional fields",
    async (marker) => {
      const cwd = freshCwd();
      writeFileSync(
        join(cwd, CONFIG_FILENAME),
        `[services.example]\n${marker}\nmcp = "example"\nregion = "local"\ncreated_by = "test"\n[services.example.meta]\ncount = 2\n`,
      );
      const config = await readConfig(cwd);
      expect(config.stack.version).toBe("1");
      expect(config.stack.project_id).toMatch(/^stk_[a-f0-9]{12}$/);
      expect(config.services.example).toMatchObject({
        provider: "example",
        secrets: [],
        mcp: "example",
        region: "local",
        created_by: "test",
        meta: { count: 2 },
      });
      expect(Number.isNaN(Date.parse(config.services.example!.created_at))).toBe(false);
      await writeConfig(config, cwd);
      expect(await readConfig(cwd)).toEqual(config);
    },
  );
});
