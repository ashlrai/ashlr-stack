import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  CONFIG_FILENAME,
  LOCAL_FILENAME,
  emptyConfig,
  getService,
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
    if (previousRegistryDir === undefined)
      Reflect.deleteProperty(process.env, "STACK_REGISTRY_DIR");
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

  test("round-trips a service name containing a hyphen through both files", async () => {
    const original = emptyConfig("fixture-template");
    original.services["fixture-api"] = {
      provider: "neon",
      resource_id: "hyphen-resource",
      region: "us-east-1",
      secrets: ["FIXTURE_API_URL", "FIXTURE_API_KEY"],
      mcp: "fixture-api",
      meta: { endpoint: "fixture-endpoint" },
      created_at: "2026-10-30T00:00:00Z",
      created_by: "test",
    };
    await writeConfig(original, cwd);

    const shape = parseToml(readFileSync(join(cwd, CONFIG_FILENAME), "utf-8"));
    const local = parseToml(readFileSync(join(cwd, LOCAL_FILENAME), "utf-8"));
    expect(Object.keys(shape.services as object)).toEqual(["fixture-api"]);
    expect(Object.keys(local.services as object)).toEqual(["fixture-api"]);
    expect(shape.services).toEqual({
      "fixture-api": {
        provider: "neon",
        secrets: ["FIXTURE_API_URL", "FIXTURE_API_KEY"],
        mcp: "fixture-api",
      },
    });
    expect(local.services).toEqual({
      "fixture-api": {
        resource_id: "hyphen-resource",
        region: "us-east-1",
        meta: { endpoint: "fixture-endpoint" },
        created_at: "2026-10-30T00:00:00Z",
        created_by: "test",
      },
    });

    const merged = await readConfig(cwd);
    expect(Object.keys(merged.services)).toEqual(["fixture-api"]);
    expect(getService(merged, "fixture-api")).toEqual(original.services["fixture-api"]);
  });

  test("legacy file with a hyphenated service name migrates without losing it", async () => {
    const legacy = `
[stack]
version = "1"
project_id = "stk_hyphen"

[services.fixture-api]
provider = "neon"
resource_id = "hyphen-legacy"
secrets = ["X"]
created_at = "2026-04-17T00:00:00Z"
`.trim();
    writeFileSync(join(cwd, CONFIG_FILENAME), legacy);
    const config = await readConfig(cwd);
    expect(Object.keys(config.services)).toEqual(["fixture-api"]);
    expect(config.services["fixture-api"].resource_id).toBe("hyphen-legacy");

    await writeConfig(config, cwd);
    const shape = readFileSync(join(cwd, CONFIG_FILENAME), "utf-8");
    expect(shape).toContain("fixture-api");
    expect(shape).not.toContain("hyphen-legacy");
    const roundTrip = await readConfig(cwd);
    expect(roundTrip.services["fixture-api"]).toEqual(config.services["fixture-api"]);
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

describe("public config reference matches produced data", () => {
  let cwd: string;
  let registry: string;
  let previousRegistryDir: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "stack-schema-config-"));
    registry = mkdtempSync(join(tmpdir(), "stack-schema-registry-"));
    previousRegistryDir = process.env.STACK_REGISTRY_DIR;
    process.env.STACK_REGISTRY_DIR = registry;
  });

  afterEach(() => {
    if (previousRegistryDir === undefined)
      Reflect.deleteProperty(process.env, "STACK_REGISTRY_DIR");
    else process.env.STACK_REGISTRY_DIR = previousRegistryDir;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(registry, { recursive: true, force: true });
  });

  function reference() {
    return JSON.parse(
      readFileSync(new URL("../../../site/public/openapi.json", import.meta.url), "utf-8"),
    ).components.schemas;
  }

  // These are field-coverage checks on actual serialized/merged values, not a
  // JSON Schema validator or a claim that readConfig validates arbitrary input.
  function expectDocumentedFields(
    value: object,
    schema: { properties: object; required?: string[] },
  ) {
    for (const key of Object.keys(value)) expect(schema.properties).toHaveProperty(key);
    for (const key of schema.required ?? []) expect(value).toHaveProperty(key);
  }

  function expectTable(value: unknown): asserts value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Expected a parsed TOML table in the synthetic config fixture.");
    }
  }

  test("StackToml describes the parsed committed output of a blank write", async () => {
    await writeConfig(emptyConfig(), cwd);
    const shape = parseToml(readFileSync(join(cwd, CONFIG_FILENAME), "utf-8"));
    const schema = reference().StackToml;

    expectDocumentedFields(shape, schema);
    expect(Object.keys(shape)).toEqual(["stack", "services", "environments"]);
    expect(schema.required).toEqual(Object.keys(shape));
    expect(schema.properties.stack.properties.version.type).toBe("string");
    expect(schema.properties).not.toHaveProperty("version");
    expect(schema.properties).not.toHaveProperty("project");
    expect(shape.stack).toEqual({ version: "1" });
    expect(shape.services).toEqual({});
    expect(shape.environments).toEqual([{ name: "dev", default: true }]);
  });

  test("committed service fields stay separate from the full merged ServiceEntry", async () => {
    const config = emptyConfig("fixture-template");
    const metadata = { note: "synthetic metadata", nested: { enabled: true } };
    config.services.primary = {
      provider: "supabase",
      resource_id: "fixture-resource",
      region: "fixture-region",
      secrets: ["FIXTURE_URL"],
      mcp: "fixture-mcp",
      meta: metadata,
      created_at: "fixture-time",
      created_by: "fixture-owner",
    };
    await writeConfig(config, cwd);
    const shape = parseToml(readFileSync(join(cwd, CONFIG_FILENAME), "utf-8"));
    const local = parseToml(readFileSync(join(cwd, LOCAL_FILENAME), "utf-8"));
    const merged = await readConfig(cwd);
    const schemas = reference();
    const committed = schemas.StackToml.properties.services.additionalProperties;
    expectTable(shape.services);
    expectTable(shape.services.primary);

    expect(committed).not.toHaveProperty("$ref");
    expectDocumentedFields(shape.services.primary, committed);
    expect(committed.required).toEqual(["provider", "secrets"]);
    expect(Object.keys(committed.properties)).toEqual(["provider", "secrets", "mcp"]);
    expect(shape.services).toEqual({
      primary: { provider: "supabase", secrets: ["FIXTURE_URL"], mcp: "fixture-mcp" },
    });
    expect(local.stack).toEqual({ project_id: config.stack.project_id });
    expect(local.services).toEqual({
      primary: {
        resource_id: "fixture-resource",
        region: "fixture-region",
        meta: metadata,
        created_at: "fixture-time",
        created_by: "fixture-owner",
      },
    });
    expect(merged.services.primary).toEqual(config.services.primary);
    expectDocumentedFields(merged.services.primary, schemas.ServiceEntry);
    expect(schemas.ServiceEntry.required).toEqual(["provider", "secrets", "created_at"]);
    expect(schemas.ServiceEntry.properties.created_at).not.toHaveProperty("format");
    expect(schemas.ServiceEntry.properties.meta.type).toBe("object");
    expect(schemas.ServiceEntry.properties.secrets.items.type).toBe("string");
    expectDocumentedFields(merged.stack, {
      properties: { version: {}, project_id: {}, template: {} },
    });
  });

  test("merged entry documentation covers actual instances independently of the committed subset", async () => {
    const config = emptyConfig();
    config.services.custom_slot = {
      provider: "neon",
      secrets: [],
      resource_id: "opaque-fixture-id",
      meta: { arbitrary: "not a credential fixture" },
      created_at: "not-a-date-validator",
    };
    await writeConfig(config, cwd);
    const merged = await readConfig(cwd);
    const schema = reference().ServiceEntry;

    expectDocumentedFields(merged.services.custom_slot, schema);
    expect(schema.properties.resource_id.type).toBe("string");
    expect(schema.properties.meta.type).toBe("object");
    expect(schema.properties.created_at.type).toBe("string");
    expect(merged.services.custom_slot.secrets).toEqual([]);
    expect(merged.services.custom_slot.mcp).toBeUndefined();
  });

  test("the writer preserves other version strings and an empty environments array", async () => {
    const config = emptyConfig();
    config.stack.version = "fixture-future-version";
    config.environments = [];
    config.services.first = { provider: "neon", secrets: [], created_at: "fixture" };
    config.services.second = { provider: "neon", secrets: [], created_at: "fixture" };
    await writeConfig(config, cwd);
    const shape = parseToml(readFileSync(join(cwd, CONFIG_FILENAME), "utf-8"));
    const schema = reference().StackToml;

    expect(shape.stack).toEqual({ version: "fixture-future-version" });
    expect(shape.environments).toEqual([]);
    expect(shape.services).toEqual({
      first: { provider: "neon", secrets: [] },
      second: { provider: "neon", secrets: [] },
    });
    expect(schema.properties.stack.properties.version.type).toBe(typeof config.stack.version);
    expect(schema.properties.stack.properties.version).not.toHaveProperty("const");
    expect(schema.properties.stack.properties.version).not.toHaveProperty("enum");
    expect(schema.properties.environments.type).toBe("array");
    expect(schema.properties.environments).not.toHaveProperty("minItems");
    expect((await readConfig(cwd)).environments).toEqual([{ name: "dev", default: true }]);
  });

  test("environment documentation covers actual overrides without enforcing one default", async () => {
    const config = emptyConfig();
    config.environments = [
      { name: "one", default: true, overrides: { FIXTURE_URL: "_ONE" } },
      { name: "two", default: true },
    ];
    await writeConfig(config, cwd);
    const merged = await readConfig(cwd);
    const schema = reference().StackToml.properties.environments.items;

    expect(merged.environments).toEqual(config.environments);
    for (const entry of merged.environments) expectDocumentedFields(entry, schema);
    expect(schema.required).toEqual(["name"]);
    expect(schema.properties.name.type).toBe("string");
    expect(schema.properties.default.type).toBe("boolean");
    expect(schema.properties.overrides.additionalProperties.type).toBe("string");
  });

  test("normal defaults and legacy precedence remain distinct from canonical file documentation", async () => {
    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      '[stack]\nversion = "fixture"\n[services.item]\nprovider = "neon"\nsecrets = []\nregion = "ignored-shape-region"\n',
    );
    writeFileSync(
      join(cwd, LOCAL_FILENAME),
      '[stack]\nproject_id = "fixture-local"\n[services.item]\nregion = "local-region"\n',
    );
    const normal = await readConfig(cwd);
    expect(normal.stack.project_id).toBe("fixture-local");
    expect(normal.services.item.region).toBe("local-region");
    expect(normal.services.item.created_at).toBe("1970-01-01T00:00:00Z");
    expect(normal.environments).toEqual([{ name: "dev", default: true }]);

    writeFileSync(
      join(cwd, CONFIG_FILENAME),
      'environments = []\n[stack]\nversion = "fixture"\nproject_id = "fixture-legacy"\n[services.item]\nresource_id = "legacy-resource"\n',
    );
    const legacy = await readConfig(cwd);
    expect(legacy.stack.project_id).toBe("fixture-legacy");
    expect(legacy.services.item.provider).toBe("item");
    expect(legacy.services.item.secrets).toEqual([]);
    expect(legacy.services.item.resource_id).toBe("legacy-resource");
    expect(legacy.services.item.region).toBeUndefined();
    expect(legacy.environments).toEqual([]);
    expect(legacy.services.item.created_at).not.toBe("1970-01-01T00:00:00Z");
    expect(readFileSync(join(cwd, LOCAL_FILENAME), "utf-8")).toContain("fixture-local");
  });
});
