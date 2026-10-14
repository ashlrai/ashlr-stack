import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  CONFIG_FILENAME,
  LOCAL_FILENAME,
  emptyConfig,
  readConfig,
  writeConfig,
  type ServiceEntry,
} from "../config.ts";

const SERVICE_NAMES = ["__proto__", "constructor", "toString", "github"];
const ENTRY: ServiceEntry = {
  provider: "github",
  secrets: ["FIXTURE_TOKEN_SLOT"],
  mcp: "fixture-mcp",
  resource_id: "fixture-resource",
  region: "fixture-region",
  meta: { account: "fixture-local-account" },
  created_at: "2026-10-14T00:00:00Z",
  created_by: "fixture-user",
};

function expectOwnService(services: Record<string, ServiceEntry>, name: string, entry: ServiceEntry): void {
  expect(Object.getPrototypeOf(services)).toBe(Object.prototype);
  expect(Object.hasOwn(services, name)).toBe(true);
  expect(Object.keys(services)).toEqual([name]);
  expect(services[name]).toEqual(entry);
  expect(JSON.parse(JSON.stringify(services))).toEqual(Object.fromEntries([[name, entry]]));
}

describe("service names remain own configuration data", () => {
  let root: string;
  let cwd: string;
  let registryDir: string;
  let previousRegistryDir: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "stack-own-services-"));
    cwd = join(root, "project");
    registryDir = join(root, "registry");
    mkdirSync(cwd);
    previousRegistryDir = process.env.STACK_REGISTRY_DIR;
    process.env.STACK_REGISTRY_DIR = registryDir;
  });

  afterEach(() => {
    if (previousRegistryDir === undefined) delete process.env.STACK_REGISTRY_DIR;
    else process.env.STACK_REGISTRY_DIR = previousRegistryDir;
    rmSync(root, { recursive: true, force: true });
  });

  test.each(SERVICE_NAMES)("reads split files without losing the %s service", async (name) => {
    writeFileSync(join(cwd, CONFIG_FILENAME), stringifyToml({
      stack: { version: "1" },
      services: Object.fromEntries([[name, {
        provider: ENTRY.provider, secrets: ENTRY.secrets, mcp: ENTRY.mcp,
      }]]),
    }));
    writeFileSync(join(cwd, LOCAL_FILENAME), stringifyToml({
      stack: { project_id: "stk_fixture" },
      services: Object.fromEntries([[name, {
        resource_id: ENTRY.resource_id, region: ENTRY.region, meta: ENTRY.meta,
        created_at: ENTRY.created_at, created_by: ENTRY.created_by,
      }]]),
    }));

    const config = await readConfig(cwd);

    expect(config.stack.project_id).toBe("stk_fixture");
    expectOwnService(config.services, name, ENTRY);
  });

  test.each(SERVICE_NAMES)("keeps %s when no local service entry exists", async (name) => {
    writeFileSync(join(cwd, CONFIG_FILENAME), stringifyToml({
      stack: { version: "1" },
      services: Object.fromEntries([[name, { provider: ENTRY.provider, secrets: ENTRY.secrets }]]),
    }));
    writeFileSync(join(cwd, LOCAL_FILENAME), stringifyToml({
      stack: { project_id: "stk_fixture" }, services: {},
    }));

    const config = await readConfig(cwd);

    expectOwnService(config.services, name, {
      provider: ENTRY.provider, secrets: ENTRY.secrets, created_at: "1970-01-01T00:00:00Z",
    });
  });

  test.each(SERVICE_NAMES)("writes and registers %s while keeping instance fields local", async (name) => {
    const original = emptyConfig("fixture-template");
    original.services = Object.fromEntries([[name, ENTRY]]);

    await writeConfig(original, cwd);

    const shapeText = readFileSync(join(cwd, CONFIG_FILENAME), "utf8");
    const shape = parseToml(shapeText);
    const local = parseToml(readFileSync(join(cwd, LOCAL_FILENAME), "utf8"));
    expect(Object.hasOwn(shape.services as object, name)).toBe(true);
    expect(Object.hasOwn(local.services as object, name)).toBe(true);
    expect((shape.services as Record<string, unknown>)[name]).toEqual({
      provider: ENTRY.provider, secrets: ENTRY.secrets, mcp: ENTRY.mcp,
    });
    expect((local.services as Record<string, unknown>)[name]).toEqual({
      resource_id: ENTRY.resource_id, region: ENTRY.region, meta: ENTRY.meta,
      created_at: ENTRY.created_at, created_by: ENTRY.created_by,
    });
    expect(shapeText).not.toContain(ENTRY.resource_id!);
    expect(shapeText).not.toContain("fixture-local-account");
    expect(shapeText).not.toContain(original.stack.project_id);
    expectOwnService((await readConfig(cwd)).services, name, ENTRY);
    const registry = JSON.parse(readFileSync(join(registryDir, "projects.json"), "utf8"));
    expect(registry.projects[0].services).toEqual([name]);
  });

  test.each(SERVICE_NAMES)("migrates a legacy %s service without losing it", async (name) => {
    writeFileSync(join(cwd, CONFIG_FILENAME), stringifyToml({
      stack: { version: "1", project_id: "stk_legacy_fixture" },
      services: Object.fromEntries([[name, ENTRY]]),
    }));

    const legacy = await readConfig(cwd);
    expectOwnService(legacy.services, name, ENTRY);
    expect(existsSync(join(cwd, LOCAL_FILENAME))).toBe(false);

    await writeConfig(legacy, cwd);

    const roundTrip = await readConfig(cwd);
    expect(roundTrip.stack.project_id).toBe("stk_legacy_fixture");
    expectOwnService(roundTrip.services, name, ENTRY);
  });
});
