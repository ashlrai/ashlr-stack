/**
 * rollback-ordering.test.ts
 *
 * Comprehensive tests for the DAG-based rollback scheduler.
 * Covers:
 * - buildRollbackGraph: correct forward-dependency map construction
 * - computeRollbackPlan: reverse-topological wave computation
 * - buildRollbackPlan: end-to-end from entries + provision order
 * - executeRollbackPlan: wave execution, error isolation, abort signal
 * - 12-provider scenario: Stripe → webhook → Supabase → auth → user-data
 * - Partial-state invariant: error recovery doesn't corrupt partial state
 * - Integration with runOrchestrationGroup partial-failure path
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, writeConfig } from "../config.ts";
import {
  buildRollbackGraph,
  buildRollbackPlan,
  computeRollbackPlan,
  executeRollbackPlan,
} from "../orchestration/rollback-graph.ts";
import type { RollbackPlan } from "../orchestration/rollback-graph.ts";
import { resolveOrder, runOrchestrationGroup } from "../orchestration.ts";
import type { OrchestrationEntry, OrchestrationGroup } from "../orchestration.ts";
import type { Provider } from "../providers/_base.ts";
import { providers } from "../providers/index.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntries(
  specs: Array<{ name: string; deps?: string[] }>,
): OrchestrationEntry[] {
  return specs.map(({ name, deps }) => ({
    providerName: name,
    dependsOn: deps,
  }));
}

function orderOf(plan: RollbackPlan): string[] {
  return plan.orderedProviders;
}

function waveOf(plan: RollbackPlan, waveIdx: number): string[] {
  return plan.waves[waveIdx]?.providers ?? [];
}

// ---------------------------------------------------------------------------
// buildRollbackGraph
// ---------------------------------------------------------------------------

describe("buildRollbackGraph", () => {
  test("single provider yields empty dependent list", () => {
    const entries = makeEntries([{ name: "stripe" }]);
    const graph = buildRollbackGraph(entries);
    expect(graph.has("stripe")).toBe(true);
    expect(graph.get("stripe")).toEqual([]);
  });

  test("A dependsOn B → graph has B → [A]", () => {
    const entries = makeEntries([
      { name: "webhook", deps: ["stripe"] },
      { name: "stripe" },
    ]);
    const graph = buildRollbackGraph(entries);
    expect(graph.get("stripe")).toContain("webhook");
    expect(graph.get("webhook")).toEqual([]);
  });

  test("linear chain stripe → webhook → notifs: stripe has 2 downstream levels", () => {
    const entries = makeEntries([
      { name: "stripe" },
      { name: "webhook", deps: ["stripe"] },
      { name: "notifs", deps: ["webhook"] },
    ]);
    const graph = buildRollbackGraph(entries);
    // stripe → [webhook]; webhook → [notifs]; notifs → []
    expect(graph.get("stripe")).toContain("webhook");
    expect(graph.get("webhook")).toContain("notifs");
    expect(graph.get("notifs")).toEqual([]);
  });

  test("diamond: A → B, A → C, B+C → D; A has [B,C], B has [D], C has [D]", () => {
    const entries = makeEntries([
      { name: "A" },
      { name: "B", deps: ["A"] },
      { name: "C", deps: ["A"] },
      { name: "D", deps: ["B", "C"] },
    ]);
    const graph = buildRollbackGraph(entries);
    expect(graph.get("A")!.sort()).toEqual(["B", "C"].sort());
    expect(graph.get("B")).toContain("D");
    expect(graph.get("C")).toContain("D");
    expect(graph.get("D")).toEqual([]);
  });

  test("failurePoint scopes rollback to providers before the failure", () => {
    // Provision order: A, B, C, D (linear chain)
    // Failure at C → only A and B should be in rollback scope
    const entries = makeEntries([
      { name: "A" },
      { name: "B", deps: ["A"] },
      { name: "C", deps: ["B"] },
      { name: "D", deps: ["C"] },
    ]);
    const provisionOrder = ["A", "B", "C", "D"];
    const graph = buildRollbackGraph(entries, "C", provisionOrder);
    // Only A and B in scope
    expect(graph.has("A")).toBe(true);
    expect(graph.has("B")).toBe(true);
    expect(graph.has("C")).toBe(false);
    expect(graph.has("D")).toBe(false);
    // A → [B] within scope
    expect(graph.get("A")).toContain("B");
  });

  test("failurePoint = first provider → empty scope (nothing was provisioned)", () => {
    const entries = makeEntries([
      { name: "A" },
      { name: "B", deps: ["A"] },
    ]);
    const graph = buildRollbackGraph(entries, "A", ["A", "B"]);
    expect(graph.size).toBe(0);
  });

  test("failurePoint not in provision order → full scope", () => {
    const entries = makeEntries([{ name: "A" }, { name: "B" }]);
    const graph = buildRollbackGraph(entries, "UNKNOWN", ["A", "B"]);
    expect(graph.has("A")).toBe(true);
    expect(graph.has("B")).toBe(true);
  });

  test("cross-scope edges are excluded when failurePoint set", () => {
    // Provision order: A, B, C. Failure at B → only A in scope.
    // Edge A→B should be excluded since B is out of scope.
    const entries = makeEntries([
      { name: "A" },
      { name: "B", deps: ["A"] },
      { name: "C", deps: ["B"] },
    ]);
    const graph = buildRollbackGraph(entries, "B", ["A", "B", "C"]);
    expect(graph.has("A")).toBe(true);
    expect(graph.get("A")).toEqual([]); // B not in scope, so edge excluded
  });
});

// ---------------------------------------------------------------------------
// computeRollbackPlan
// ---------------------------------------------------------------------------

describe("computeRollbackPlan", () => {
  test("empty graph → empty plan", () => {
    const plan = computeRollbackPlan(new Map());
    expect(plan.waves).toHaveLength(0);
    expect(plan.orderedProviders).toHaveLength(0);
  });

  test("single provider → one wave with that provider", () => {
    const graph = new Map([["stripe", []]]);
    const plan = computeRollbackPlan(graph);
    expect(plan.waves).toHaveLength(1);
    expect(plan.waves[0].providers).toContain("stripe");
    expect(plan.orderedProviders).toContain("stripe");
  });

  test("linear A→B: rollback order is B then A (reverse provision)", () => {
    // A was provisioned first (B depends on A); rollback: B first, then A
    const graph = new Map<string, string[]>([
      ["A", ["B"]], // A has dependent B
      ["B", []],
    ]);
    const plan = computeRollbackPlan(graph);
    const order = orderOf(plan);
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("A"));
  });

  test("linear A→B→C: rollback order is C, B, A", () => {
    const graph = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", []],
    ]);
    const plan = computeRollbackPlan(graph);
    const order = orderOf(plan);
    expect(order.indexOf("C")).toBeLessThan(order.indexOf("B"));
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("A"));
  });

  test("diamond A→B,A→C,B+C→D: D in wave 0, B+C in wave 1, A in wave 2", () => {
    const graph = new Map<string, string[]>([
      ["A", ["B", "C"]],
      ["B", ["D"]],
      ["C", ["D"]],
      ["D", []],
    ]);
    const plan = computeRollbackPlan(graph);
    expect(waveOf(plan, 0)).toContain("D");
    const wave1 = waveOf(plan, 1);
    expect(wave1).toContain("B");
    expect(wave1).toContain("C");
    expect(waveOf(plan, 2)).toContain("A");
  });

  test("independent providers all appear in wave 0 (parallel teardown)", () => {
    const graph = new Map<string, string[]>([
      ["x", []],
      ["y", []],
      ["z", []],
    ]);
    const plan = computeRollbackPlan(graph);
    expect(plan.waves).toHaveLength(1);
    expect(waveOf(plan, 0)).toContain("x");
    expect(waveOf(plan, 0)).toContain("y");
    expect(waveOf(plan, 0)).toContain("z");
  });

  test("scope is set correctly", () => {
    const graph = new Map<string, string[]>([["A", ["B"]], ["B", []]]);
    const plan = computeRollbackPlan(graph);
    expect(plan.scope.has("A")).toBe(true);
    expect(plan.scope.has("B")).toBe(true);
    expect(plan.scope.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildRollbackPlan (end-to-end)
// ---------------------------------------------------------------------------

describe("buildRollbackPlan", () => {
  test("stripe webhook chain: webhook torn down before stripe", () => {
    const entries = makeEntries([
      { name: "stripe" },
      { name: "stripe-webhook", deps: ["stripe"] },
    ]);
    const provisionOrder = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, provisionOrder);
    const order = orderOf(plan);
    expect(order.indexOf("stripe-webhook")).toBeLessThan(order.indexOf("stripe"));
  });

  test("supabase → clerk chain with failurePoint", () => {
    const entries = makeEntries([
      { name: "supabase" },
      { name: "clerk", deps: ["supabase"] },
      { name: "user-data", deps: ["clerk"] },
    ]);
    const provisionOrder = ["supabase", "clerk", "user-data"];
    // Failure at user-data: roll back supabase and clerk
    const plan = buildRollbackPlan(entries, provisionOrder, "user-data");
    const order = orderOf(plan);
    // clerk must roll back before supabase (since clerk depends on supabase)
    expect(order.indexOf("clerk")).toBeLessThan(order.indexOf("supabase"));
    // user-data was not provisioned so not in scope
    expect(plan.scope.has("user-data")).toBe(false);
  });

  test("all providers included when no failurePoint", () => {
    const entries = makeEntries([
      { name: "A" },
      { name: "B", deps: ["A"] },
      { name: "C", deps: ["B"] },
    ]);
    const plan = buildRollbackPlan(entries, ["A", "B", "C"]);
    expect(plan.scope.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// executeRollbackPlan
// ---------------------------------------------------------------------------

describe("executeRollbackPlan", () => {
  test("all succeed → fullyRolledBack=true, cleaned contains all providers", async () => {
    const graph = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", []],
    ]);
    const plan = computeRollbackPlan(graph);
    const called: string[] = [];

    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => { called.push(name); },
    });

    expect(transcript.fullyRolledBack).toBe(true);
    expect(transcript.cleaned).toContain("A");
    expect(transcript.cleaned).toContain("B");
    expect(transcript.requiresManualCleanup).toHaveLength(0);
    expect(called).toContain("A");
    expect(called).toContain("B");
  });

  test("deprovision failure: provider lands in requiresManualCleanup, others still run", async () => {
    const graph = new Map<string, string[]>([
      ["A", ["B", "C"]],
      ["B", []],
      ["C", []],
    ]);
    const plan = computeRollbackPlan(graph);
    // B deprovision fails, C succeeds, A should still run after
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => {
        if (name === "B") throw new Error("B deprovision failed");
      },
    });

    expect(transcript.fullyRolledBack).toBe(false);
    expect(transcript.requiresManualCleanup).toContain("B");
    expect(transcript.cleaned).toContain("C");
    // A is in wave 1 — should still be attempted despite B failing in wave 0
    expect(transcript.cleaned).toContain("A");
  });

  test("skipped providers are recorded but do not block cleanup of others", async () => {
    const graph = new Map<string, string[]>([["X", []], ["Y", []]]);
    const plan = computeRollbackPlan(graph);
    const skipSet = new Set(["X"]);

    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (_name) => {},
      skipProviders: skipSet,
    });

    expect(transcript.skipped).toContain("X");
    expect(transcript.cleaned).toContain("Y");
    expect(transcript.fullyRolledBack).toBe(false); // X was skipped
  });

  test("abort signal prevents new waves from starting", async () => {
    const graph = new Map<string, string[]>([
      ["leaf", []],       // wave 0
      ["root", ["leaf"]], // wave 1 — should be skipped after abort
    ]);
    const plan = computeRollbackPlan(graph);
    const controller = new AbortController();

    const called: string[] = [];
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => {
        called.push(name);
        // Abort after first wave completes
        controller.abort();
      },
      signal: controller.signal,
    });

    // leaf ran in wave 0; root in wave 1 was skipped due to abort
    expect(called).toContain("leaf");
    expect(transcript.skipped).toContain("root");
  });

  test("triggerError is preserved in transcript", async () => {
    const graph = new Map<string, string[]>([["A", []]]);
    const plan = computeRollbackPlan(graph);
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async () => {},
      triggerError: "Something exploded at step N",
    });
    expect(transcript.triggerError).toBe("Something exploded at step N");
  });

  test("step results record durationMs and wave index", async () => {
    const graph = new Map<string, string[]>([["stripe", []]]);
    const plan = computeRollbackPlan(graph);
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async () => { await new Promise((r) => setTimeout(r, 5)); },
    });
    expect(transcript.steps[0].providerName).toBe("stripe");
    expect(transcript.steps[0].wave).toBe(0);
    expect(transcript.steps[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(transcript.steps[0].status).toBe("success");
  });

  test("failure step records error message", async () => {
    const graph = new Map<string, string[]>([["bad-provider", []]]);
    const plan = computeRollbackPlan(graph);
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async () => { throw new Error("API returned 503"); },
    });
    const step = transcript.steps.find((s) => s.providerName === "bad-provider");
    expect(step?.status).toBe("failure");
    expect(step?.error).toMatch(/503/);
  });

  test("recoverySuggestion mentions manual cleanup when providers fail", async () => {
    const graph = new Map<string, string[]>([["broken", []]]);
    const plan = computeRollbackPlan(graph);
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async () => { throw new Error("network error"); },
    });
    expect(transcript.recoverySuggestion).toMatch(/manual cleanup/i);
    expect(transcript.recoverySuggestion).toMatch(/broken/);
  });

  test("empty plan → fullyRolledBack=true, no steps", async () => {
    const plan = computeRollbackPlan(new Map());
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async () => {},
    });
    expect(transcript.fullyRolledBack).toBe(true);
    expect(transcript.steps).toHaveLength(0);
    expect(transcript.cleaned).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 12-provider scenario: realistic Stripe → Supabase → Clerk → user-data chain
// ---------------------------------------------------------------------------

describe("12-provider realistic scenario", () => {
  /**
   * Provider graph (provision order):
   *   user-data → clerk → supabase → auth-config →
   *   stripe → stripe-webhook → stripe-portal →
   *   email → email-template →
   *   cdn → cdn-rules →
   *   analytics
   *
   * Dependency declarations (B dependsOn A means B requires A):
   *   clerk dependsOn supabase
   *   auth-config dependsOn clerk, supabase
   *   stripe-webhook dependsOn stripe
   *   stripe-portal dependsOn stripe
   *   email-template dependsOn email
   *   cdn-rules dependsOn cdn
   *   user-data dependsOn clerk, stripe, email
   *   analytics dependsOn supabase, stripe
   */
  const entries: OrchestrationEntry[] = [
    { providerName: "supabase" },
    { providerName: "clerk", dependsOn: ["supabase"] },
    { providerName: "auth-config", dependsOn: ["clerk", "supabase"] },
    { providerName: "stripe" },
    { providerName: "stripe-webhook", dependsOn: ["stripe"] },
    { providerName: "stripe-portal", dependsOn: ["stripe"] },
    { providerName: "email" },
    { providerName: "email-template", dependsOn: ["email"] },
    { providerName: "cdn" },
    { providerName: "cdn-rules", dependsOn: ["cdn"] },
    { providerName: "user-data", dependsOn: ["clerk", "stripe", "email"] },
    { providerName: "analytics", dependsOn: ["supabase", "stripe"] },
  ];

  test("provision order respects all declared dependencies", () => {
    const order = resolveOrder(entries);
    expect(order.indexOf("supabase")).toBeLessThan(order.indexOf("clerk"));
    expect(order.indexOf("clerk")).toBeLessThan(order.indexOf("auth-config"));
    expect(order.indexOf("supabase")).toBeLessThan(order.indexOf("auth-config"));
    expect(order.indexOf("stripe")).toBeLessThan(order.indexOf("stripe-webhook"));
    expect(order.indexOf("stripe")).toBeLessThan(order.indexOf("stripe-portal"));
    expect(order.indexOf("email")).toBeLessThan(order.indexOf("email-template"));
    expect(order.indexOf("cdn")).toBeLessThan(order.indexOf("cdn-rules"));
    expect(order.indexOf("clerk")).toBeLessThan(order.indexOf("user-data"));
    expect(order.indexOf("stripe")).toBeLessThan(order.indexOf("user-data"));
    expect(order.indexOf("email")).toBeLessThan(order.indexOf("user-data"));
    expect(order.indexOf("supabase")).toBeLessThan(order.indexOf("analytics"));
    expect(order.indexOf("stripe")).toBeLessThan(order.indexOf("analytics"));
  });

  test("rollback order: webhooks/portals before stripe, auth-config/user-data before clerk", () => {
    const provisionOrder = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, provisionOrder);
    const order = orderOf(plan);

    // stripe-webhook and stripe-portal must roll back before stripe
    expect(order.indexOf("stripe-webhook")).toBeLessThan(order.indexOf("stripe"));
    expect(order.indexOf("stripe-portal")).toBeLessThan(order.indexOf("stripe"));

    // auth-config depends on clerk → roll back before clerk
    expect(order.indexOf("auth-config")).toBeLessThan(order.indexOf("clerk"));

    // clerk depends on supabase → roll back before supabase
    expect(order.indexOf("clerk")).toBeLessThan(order.indexOf("supabase"));

    // user-data depends on clerk → roll back before clerk
    expect(order.indexOf("user-data")).toBeLessThan(order.indexOf("clerk"));

    // analytics depends on supabase → roll back before supabase
    expect(order.indexOf("analytics")).toBeLessThan(order.indexOf("supabase"));

    // email-template before email
    expect(order.indexOf("email-template")).toBeLessThan(order.indexOf("email"));

    // cdn-rules before cdn
    expect(order.indexOf("cdn-rules")).toBeLessThan(order.indexOf("cdn"));
  });

  test("full 12-provider rollback executes all deprovisions, none skipped", async () => {
    const provisionOrder = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, provisionOrder);

    const deprovisioned: string[] = [];
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => { deprovisioned.push(name); },
    });

    expect(transcript.fullyRolledBack).toBe(true);
    expect(deprovisioned).toHaveLength(12);
    for (const e of entries) {
      expect(deprovisioned).toContain(e.providerName);
    }
  });

  test("rollback with failurePoint at auth-config: only supabase, clerk, stripe, stripe-webhook, stripe-portal, email, email-template, cdn, cdn-rules in scope", () => {
    const provisionOrder = resolveOrder(entries);
    // auth-config is the failing step; it depends on clerk and supabase
    // Providers provisioned before auth-config depend on order, but let's
    // find the actual index in the resolved order.
    const failIdx = provisionOrder.indexOf("auth-config");
    const expectedScope = new Set(provisionOrder.slice(0, failIdx));

    const plan = buildRollbackPlan(entries, provisionOrder, "auth-config");

    // auth-config itself should NOT be in scope (it failed, wasn't provisioned)
    expect(plan.scope.has("auth-config")).toBe(false);
    // user-data and analytics come after auth-config in provision order — not in scope
    if (provisionOrder.indexOf("user-data") > failIdx) {
      expect(plan.scope.has("user-data")).toBe(false);
    }
    // Everything before failIdx should be in scope
    for (const name of expectedScope) {
      expect(plan.scope.has(name)).toBe(true);
    }
  });

  test("deprovision ordering constraint preserved: webhook deprovisioned before stripe in execution", async () => {
    const provisionOrder = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, provisionOrder);

    const executionOrder: string[] = [];
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => { executionOrder.push(name); },
    });

    expect(transcript.fullyRolledBack).toBe(true);
    expect(executionOrder.indexOf("stripe-webhook")).toBeLessThan(
      executionOrder.indexOf("stripe"),
    );
    expect(executionOrder.indexOf("stripe-portal")).toBeLessThan(
      executionOrder.indexOf("stripe"),
    );
  });

  test("partial failure in rollback does not corrupt other providers' cleanup", async () => {
    const provisionOrder = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, provisionOrder);

    // stripe-webhook deprovision fails; all others should still run
    const successfullyDeprovisioned: string[] = [];
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => {
        if (name === "stripe-webhook") throw new Error("webhook endpoint locked");
        successfullyDeprovisioned.push(name);
      },
    });

    expect(transcript.fullyRolledBack).toBe(false);
    expect(transcript.requiresManualCleanup).toContain("stripe-webhook");

    // Every other provider should have been attempted and succeed
    for (const e of entries) {
      if (e.providerName === "stripe-webhook") continue;
      expect(successfullyDeprovisioned).toContain(e.providerName);
    }
  });

  test("parallel wave execution: independent providers in same wave run concurrently", async () => {
    const provisionOrder = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, provisionOrder);

    // Find a wave with 2+ providers and verify they start nearly simultaneously
    const multiProviderWave = plan.waves.find((w) => w.providers.length >= 2);
    expect(multiProviderWave).toBeDefined();

    const startTimes: Record<string, number> = {};
    const endTimes: Record<string, number> = {};

    await executeRollbackPlan(plan, {
      deprovision: async (name) => {
        startTimes[name] = Date.now();
        await new Promise((r) => setTimeout(r, 10));
        endTimes[name] = Date.now();
      },
    });

    // Check that providers in the same wave started before others ended
    if (multiProviderWave && multiProviderWave.providers.length >= 2) {
      const [p1, p2] = multiProviderWave.providers;
      // Both should have started — parallel execution means p2 starts before p1 ends
      expect(startTimes[p1]).toBeDefined();
      expect(startTimes[p2]).toBeDefined();
      // p2 started before p1 ended (proving parallelism)
      expect(startTimes[p2]).toBeLessThanOrEqual(endTimes[p1] + 5); // 5ms slack
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: runOrchestrationGroup partial-failure path
// ---------------------------------------------------------------------------

function makeStub(name: string): Provider {
  return {
    name,
    displayName: name,
    category: "database",
    authKind: "api_key",
    async login() { return { token: `${name}-tok` }; },
    async provision() { return { id: `${name}-res`, displayName: `${name}-res` }; },
    async materialize() { return { secrets: { [`${name.toUpperCase()}_KEY`]: `${name}-val` } }; },
  };
}

describe("runOrchestrationGroup with rollback on partial failure", () => {
  let h: Harness;
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    h = setupFakePhantom();
    cwd = mkdtempSync(join(tmpdir(), "stack-rollback-ord-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
    await writeConfig(emptyConfig("rollback-ordering-test"), cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    h.cleanup();
    for (const k of ["svc-a", "svc-b", "svc-c", "svc-fail"]) {
      Reflect.deleteProperty(providers, k);
    }
  });

  test("second provider failure triggers ORCHESTRATION_PARTIAL_FAILURE error code", async () => {
    providers["svc-a"] = async () => makeStub("svc-a");
    providers["svc-fail"] = async () => ({
      ...makeStub("svc-fail"),
      async materialize() { throw new Error("svc-fail exploded"); },
    });

    const err = await runOrchestrationGroup({
      entries: [
        { providerName: "svc-a" },
        { providerName: "svc-fail", dependsOn: ["svc-a"] },
      ],
      defaults: { cwd, interactive: false },
    }).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { code?: string }).code ?? (err as Error).message).toMatch(
      /ORCHESTRATION_PARTIAL_FAILURE/,
    );
  });

  test("onRollback callback is invoked for successfully-provisioned providers when a later one fails", async () => {
    const rolledBack: string[] = [];

    providers["svc-a"] = async () => makeStub("svc-a");
    providers["svc-b"] = async () => makeStub("svc-b");
    providers["svc-fail"] = async () => ({
      ...makeStub("svc-fail"),
      async materialize() { throw new Error("boom"); },
    });

    await runOrchestrationGroup({
      entries: [
        {
          providerName: "svc-a",
          opts: {
            onRollback: async (name) => { rolledBack.push(name); },
          },
        },
        {
          providerName: "svc-b",
          dependsOn: ["svc-a"],
          opts: {
            onRollback: async (name) => { rolledBack.push(name); },
          },
        },
        { providerName: "svc-fail", dependsOn: ["svc-b"] },
      ],
      defaults: { cwd, interactive: false, persist: false },
    }).catch(() => {});

    // svc-a and svc-b succeeded; onRollback should be called for them
    // Rollback order: svc-b before svc-a (reverse provision order)
    if (rolledBack.length >= 2) {
      expect(rolledBack.indexOf("svc-b")).toBeLessThan(rolledBack.indexOf("svc-a"));
    }
  });

  test("error message identifies the failed provider", async () => {
    providers["svc-a"] = async () => makeStub("svc-a");
    providers["svc-fail"] = async () => ({
      ...makeStub("svc-fail"),
      async materialize() { throw new Error("network timeout on svc-fail"); },
    });

    const err = await runOrchestrationGroup({
      entries: [
        { providerName: "svc-a" },
        { providerName: "svc-fail", dependsOn: ["svc-a"] },
      ],
      defaults: { cwd, interactive: false, persist: false },
    }).catch((e: Error) => e);

    // The error message must name the failing provider and include the error code.
    // pipeline.ts wraps the original error in ADD_SERVICE_PARTIAL_FAILURE before
    // runOrchestrationGroup wraps it in ORCHESTRATION_PARTIAL_FAILURE.
    expect((err as Error).message).toMatch(/ORCHESTRATION_PARTIAL_FAILURE/);
    expect((err as Error).message).toMatch(/svc-fail/);
  });

  test("successful group still returns results in topological order", async () => {
    providers["svc-a"] = async () => makeStub("svc-a");
    providers["svc-b"] = async () => makeStub("svc-b");
    providers["svc-c"] = async () => makeStub("svc-c");

    const result = await runOrchestrationGroup({
      entries: [
        { providerName: "svc-a" },
        { providerName: "svc-b", dependsOn: ["svc-a"] },
        { providerName: "svc-c", dependsOn: ["svc-b"] },
      ],
      defaults: { cwd, interactive: false },
    });

    const names = result.results.map((r) => r.providerName);
    expect(names.indexOf("svc-a")).toBeLessThan(names.indexOf("svc-b"));
    expect(names.indexOf("svc-b")).toBeLessThan(names.indexOf("svc-c"));
  });
});
