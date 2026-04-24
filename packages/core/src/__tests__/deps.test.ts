import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, writeConfig } from "../config.ts";
import { getProvider, listProviderNames } from "../providers/index.ts";

describe("provider loading — wave 9 additions", () => {
  test("render + firebase are in the catalog", () => {
    const names = listProviderNames();
    expect(names).toContain("render");
    expect(names).toContain("firebase");
  });

  test("render loads and exposes healthcheck", async () => {
    const render = await getProvider("render");
    expect(render.name).toBe("render");
    expect(render.category).toBe("deploy");
    expect(typeof render.healthcheck).toBe("function");
  });

  test("firebase loads and exposes verify-shape logic", async () => {
    const firebase = await getProvider("firebase");
    expect(firebase.name).toBe("firebase");
    expect(firebase.category).toBe("database");
  });
});

describe("config carrying 21+ provider entries still round-trips", () => {
  let cwd: string;
  let previousRegistryDir: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "stack-deps-"));
    previousRegistryDir = process.env.STACK_REGISTRY_DIR;
    process.env.STACK_REGISTRY_DIR = mkdtempSync(join(tmpdir(), "stack-deps-reg-"));
  });

  afterEach(() => {
    if (previousRegistryDir === undefined) process.env.STACK_REGISTRY_DIR = undefined;
    else process.env.STACK_REGISTRY_DIR = previousRegistryDir;
  });

  test("all 21+ providers can coexist in one .stack.toml", async () => {
    const config = emptyConfig("mega");
    for (const name of listProviderNames()) {
      config.services[name] = {
        provider: name,
        secrets: [`${name.toUpperCase()}_SECRET`],
        created_at: new Date().toISOString(),
      };
    }
    await writeConfig(config, cwd);
    const { readConfig } = await import("../config.ts");
    const roundtrip = await readConfig(cwd);
    expect(Object.keys(roundtrip.services).length).toBe(listProviderNames().length);
  });
});
