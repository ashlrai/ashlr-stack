import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, writeConfig } from "../config.ts";
import { resolveOrder, runOrchestrationGroup } from "../orchestration.ts";
import type { OrchestrationGroup } from "../orchestration.ts";
import type { Provider } from "../providers/_base.ts";
import { providers } from "../providers/index.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

// ---------------------------------------------------------------------------
// resolveOrder — pure unit tests (no I/O)
// ---------------------------------------------------------------------------

describe("resolveOrder", () => {
  test("single entry returns itself", () => {
    expect(resolveOrder([{ providerName: "a" }])).toEqual(["a"]);
  });

  test("linear chain: a → b → c resolves in order a, b, c", () => {
    const order = resolveOrder([
      { providerName: "c", dependsOn: ["b"] },
      { providerName: "b", dependsOn: ["a"] },
      { providerName: "a" },
    ]);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
  });

  test("independent entries both appear (order between them unspecified)", () => {
    const order = resolveOrder([{ providerName: "x" }, { providerName: "y" }]);
    expect(order).toHaveLength(2);
    expect(order).toContain("x");
    expect(order).toContain("y");
  });

  test("diamond: a → b, a → c, b + c → d", () => {
    const order = resolveOrder([
      { providerName: "a" },
      { providerName: "b", dependsOn: ["a"] },
      { providerName: "c", dependsOn: ["a"] },
      { providerName: "d", dependsOn: ["b", "c"] },
    ]);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
  });

  test("detects a direct cycle (a → b → a) and throws ORCHESTRATION_CYCLE", () => {
    expect(() =>
      resolveOrder([
        { providerName: "a", dependsOn: ["b"] },
        { providerName: "b", dependsOn: ["a"] },
      ]),
    ).toThrow(/ORCHESTRATION_CYCLE/);
  });

  test("detects a three-node cycle and throws ORCHESTRATION_CYCLE", () => {
    expect(() =>
      resolveOrder([
        { providerName: "a", dependsOn: ["c"] },
        { providerName: "b", dependsOn: ["a"] },
        { providerName: "c", dependsOn: ["b"] },
      ]),
    ).toThrow(/ORCHESTRATION_CYCLE/);
  });

  test("throws ORCHESTRATION_UNKNOWN_DEP for a dep outside the group", () => {
    expect(() =>
      resolveOrder([{ providerName: "a", dependsOn: ["not-in-group"] }]),
    ).toThrow(/ORCHESTRATION_UNKNOWN_DEP/);
  });

  test("empty entries returns empty array", () => {
    expect(resolveOrder([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runOrchestrationGroup — integration tests with stub providers
// ---------------------------------------------------------------------------

function makeStub(name: string, secretKey: string, secretVal: string): Provider {
  return {
    name,
    displayName: name,
    category: "database",
    authKind: "api_key",
    async login() {
      return { token: `${name}-token` };
    },
    async provision() {
      return { id: `${name}-resource`, displayName: `${name}-resource` };
    },
    async materialize() {
      return { secrets: { [secretKey]: secretVal } };
    },
  };
}

describe("runOrchestrationGroup", () => {
  let h: Harness;
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    h = setupFakePhantom();
    cwd = mkdtempSync(join(tmpdir(), "stack-orch-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
    await writeConfig(emptyConfig("orch-test"), cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    h.cleanup();
    // Unregister all stubs.
    for (const k of ["db", "app", "cache", "svc1", "svc2", "svc3"]) {
      Reflect.deleteProperty(providers, k);
    }
  });

  test("single provider works (addService compat)", async () => {
    providers.db = async () => makeStub("db", "DB_URL", "postgres://localhost/test");
    const result = await runOrchestrationGroup({
      entries: [{ providerName: "db" }],
      defaults: { cwd, interactive: false },
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].providerName).toBe("db");
    expect(result.byProvider.get("db")).toBeDefined();
  });

  test("dependency ordering: db provisions before app", async () => {
    const provisionOrder: string[] = [];

    providers.db = async () => ({
      ...makeStub("db", "DB_URL", "postgres://localhost/test"),
      async provision(ctx) {
        provisionOrder.push("db");
        return { id: "db-resource", displayName: "db-resource" };
      },
    });
    providers.app = async () => ({
      ...makeStub("app", "APP_KEY", "app-secret"),
      async provision(ctx) {
        provisionOrder.push("app");
        return { id: "app-resource", displayName: "app-resource" };
      },
    });

    await runOrchestrationGroup({
      entries: [
        { providerName: "db" },
        { providerName: "app", dependsOn: ["db"] },
      ],
      defaults: { cwd, interactive: false },
    });

    expect(provisionOrder.indexOf("db")).toBeLessThan(provisionOrder.indexOf("app"));
  });

  test("independent providers run in parallel (both complete)", async () => {
    const startTimes: Record<string, number> = {};
    const endTimes: Record<string, number> = {};

    // Both providers record timing but don't persist (avoids concurrent toml write race).
    providers.svc1 = async () => ({
      ...makeStub("svc1", "SVC1_KEY", "val1"),
      async provision(ctx) {
        startTimes.svc1 = Date.now();
        await new Promise((r) => setTimeout(r, 20));
        endTimes.svc1 = Date.now();
        return { id: "svc1-resource", displayName: "svc1-resource" };
      },
    });
    providers.svc2 = async () => ({
      ...makeStub("svc2", "SVC2_KEY", "val2"),
      async provision(ctx) {
        startTimes.svc2 = Date.now();
        await new Promise((r) => setTimeout(r, 20));
        endTimes.svc2 = Date.now();
        return { id: "svc2-resource", displayName: "svc2-resource" };
      },
    });

    const result = await runOrchestrationGroup({
      entries: [{ providerName: "svc1" }, { providerName: "svc2" }],
      // persist:false avoids concurrent .stack.toml write race between parallel providers.
      defaults: { cwd, interactive: false, persist: false },
    });

    expect(result.results).toHaveLength(2);
    expect(result.byProvider.has("svc1")).toBe(true);
    expect(result.byProvider.has("svc2")).toBe(true);

    // Verify they actually ran in parallel: svc2 started before svc1 ended.
    expect(startTimes.svc2).toBeLessThan(endTimes.svc1);
  });

  test("output threading: dependent receives resolvedOutputs from dependency", async () => {
    providers.db = async () => makeStub("db", "DB_URL", "postgres://localhost/db");

    let receivedHints: Record<string, unknown> | undefined;
    providers.app = async () => ({
      ...makeStub("app", "APP_KEY", "app-secret"),
      async provision(ctx) {
        receivedHints = ctx.hints;
        return { id: "app-resource", displayName: "app-resource" };
      },
    });

    await runOrchestrationGroup({
      entries: [
        { providerName: "db" },
        { providerName: "app", dependsOn: ["db"] },
      ],
      defaults: { cwd, interactive: false },
    });

    expect(receivedHints).toBeDefined();
    const resolvedOutputs = receivedHints?.resolvedOutputs as Record<string, unknown>;
    expect(resolvedOutputs).toBeDefined();
    expect(resolvedOutputs.db).toBeDefined();
    const dbResult = resolvedOutputs.db as { providerName: string; resourceId: string };
    expect(dbResult.providerName).toBe("db");
    expect(dbResult.resourceId).toBe("db-resource");
  });

  test("empty group returns empty results", async () => {
    const result = await runOrchestrationGroup({ entries: [] });
    expect(result.results).toHaveLength(0);
    expect(result.byProvider.size).toBe(0);
  });

  test("results are returned in topological order", async () => {
    providers.svc3 = async () => makeStub("svc3", "SVC3_KEY", "v3");
    providers.svc1 = async () => makeStub("svc1", "SVC1_KEY", "v1");
    providers.svc2 = async () => makeStub("svc2", "SVC2_KEY", "v2");

    const result = await runOrchestrationGroup({
      entries: [
        { providerName: "svc3", dependsOn: ["svc1", "svc2"] },
        { providerName: "svc2", dependsOn: ["svc1"] },
        { providerName: "svc1" },
      ],
      defaults: { cwd, interactive: false },
    });

    const names = result.results.map((r) => r.providerName);
    expect(names.indexOf("svc1")).toBeLessThan(names.indexOf("svc2"));
    expect(names.indexOf("svc2")).toBeLessThan(names.indexOf("svc3"));
  });

  test("cycle in group throws ORCHESTRATION_CYCLE before any provisioning", async () => {
    // These providers should never be called.
    providers.svc1 = async () => makeStub("svc1", "SVC1_KEY", "v1");
    providers.svc2 = async () => makeStub("svc2", "SVC2_KEY", "v2");

    await expect(
      runOrchestrationGroup({
        entries: [
          { providerName: "svc1", dependsOn: ["svc2"] },
          { providerName: "svc2", dependsOn: ["svc1"] },
        ],
        defaults: { cwd, interactive: false },
      }),
    ).rejects.toThrow(/ORCHESTRATION_CYCLE/);
  });
});
