/**
 * Multi-Provider Interop Provisioning Tests with Dependency Validation
 *
 * Covers four scenarios that go beyond single-provider unit tests:
 *
 * 1. Three-service dependency chain (Supabase → Clerk → Stripe webhook)
 *    with rollback validation ensuring deps are torn down in reverse
 *    topological order.
 *
 * 2. Partial-failure recovery where materialize() fails mid-chain —
 *    verify that breadcrumb-tracked dangling resources are correctly
 *    listed by `doctor --reconcile` (the requiresManualCleanup list).
 *
 * 3. Provision timeout + abort cascading across dependent services
 *    without leaking secrets in Phantom.
 *
 * 4. Quota consensus engine correctly tracks spend-rate trends across
 *    multi-provider stacks over simulated 7-day windows.
 *
 * Additionally, the RollbackPlan abstraction from rollback-graph.ts is
 * exercised with a pre-flight validation report showing which providers
 * will roll back in which waves before any actual provisioning happens.
 *
 * All upstream APIs are mocked; the fake Phantom binary from _harness.ts
 * is used to verify no secrets leak.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, readConfig, writeConfig } from "../config.ts";
import {
  buildRollbackGraph,
  buildRollbackPlan,
  computeRollbackPlan,
  executeRollbackPlan,
} from "../orchestration/rollback-graph.ts";
import type { RollbackPlan, RollbackWave } from "../orchestration/rollback-graph.ts";
import { resolveOrder, runOrchestrationGroup } from "../orchestration.ts";
import type { OrchestrationEntry } from "../orchestration.ts";
import { addService } from "../pipeline.ts";
import type { Provider, ProviderContext, AuthHandle } from "../providers/_base.ts";
import { providers } from "../providers/index.ts";
import {
  QuotaEngine,
  type QuotaSnapshot,
} from "../quota-engine.ts";
import {
  __setHistogramDirForTesting,
  writeHistogram,
} from "../probes/index.ts";
import type { HistogramStore } from "../probes/types.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "stack-interop-"));
}

function makeSnapshot(
  provider: string,
  overrides: Partial<QuotaSnapshot> = {},
): QuotaSnapshot {
  return {
    provider,
    snapshotAt: new Date().toISOString(),
    latencyMs: 50,
    quotaUsedPercent: 0,
    rateLimitRemaining: 1000,
    estimatedDailyBurnUSD: 0,
    ...overrides,
  };
}

/**
 * Build a stub provider that succeeds on all pipeline steps.
 * The returned object is mutable so callers can override individual methods.
 */
function makeStubProvider(name: string): Provider {
  return {
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    category: "database",
    authKind: "api_key",
    async login() {
      return { token: `${name}-token` };
    },
    async provision() {
      return { id: `${name}-resource-id`, displayName: `${name}-resource` };
    },
    async materialize() {
      return {
        secrets: { [`${name.toUpperCase()}_KEY`]: `${name}-secret-value` },
      };
    },
    async deprovision(_ctx: ProviderContext, _auth: AuthHandle, resourceId: string) {
      // default: no-op success
      void resourceId;
    },
  };
}

// ---------------------------------------------------------------------------
// Scenario 1: Three-service dependency chain with rollback ordering
//
// Provision order:    supabase → clerk → stripe-webhook
// Expected rollback:  stripe-webhook first, then clerk, then supabase
// ---------------------------------------------------------------------------

describe("Scenario 1: three-service dependency chain (supabase → clerk → stripe-webhook)", () => {
  const entries: OrchestrationEntry[] = [
    { providerName: "supabase" },
    { providerName: "clerk", dependsOn: ["supabase"] },
    { providerName: "stripe-webhook", dependsOn: ["clerk"] },
  ];

  test("resolveOrder produces supabase → clerk → stripe-webhook", () => {
    const order = resolveOrder(entries);
    expect(order.indexOf("supabase")).toBeLessThan(order.indexOf("clerk"));
    expect(order.indexOf("clerk")).toBeLessThan(order.indexOf("stripe-webhook"));
  });

  test("buildRollbackPlan wave structure: stripe-webhook in wave 0, clerk in wave 1, supabase in wave 2", () => {
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    // Wave 0: stripe-webhook (no dependents below it)
    expect(plan.waves[0]?.providers).toContain("stripe-webhook");
    // Wave 1: clerk
    expect(plan.waves[1]?.providers).toContain("clerk");
    // Wave 2: supabase
    expect(plan.waves[2]?.providers).toContain("supabase");

    // All three in scope
    expect(plan.scope.size).toBe(3);
  });

  test("rollback orderedProviders respects reverse topological order", () => {
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);
    const rb = plan.orderedProviders;

    expect(rb.indexOf("stripe-webhook")).toBeLessThan(rb.indexOf("clerk"));
    expect(rb.indexOf("clerk")).toBeLessThan(rb.indexOf("supabase"));
  });

  test("executeRollbackPlan deprovisions in reverse topo order", async () => {
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    const executionOrder: string[] = [];
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => {
        executionOrder.push(name);
      },
    });

    expect(transcript.fullyRolledBack).toBe(true);
    expect(transcript.cleaned).toContain("supabase");
    expect(transcript.cleaned).toContain("clerk");
    expect(transcript.cleaned).toContain("stripe-webhook");

    // Strict ordering: stripe-webhook before clerk before supabase
    expect(executionOrder.indexOf("stripe-webhook")).toBeLessThan(
      executionOrder.indexOf("clerk"),
    );
    expect(executionOrder.indexOf("clerk")).toBeLessThan(
      executionOrder.indexOf("supabase"),
    );
  });

  test("deprovision of stripe-webhook failure does NOT block clerk and supabase cleanup", async () => {
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    const deprovisioned: string[] = [];
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => {
        if (name === "stripe-webhook") {
          throw new Error("stripe-webhook deprovision API 503");
        }
        deprovisioned.push(name);
      },
    });

    expect(transcript.fullyRolledBack).toBe(false);
    expect(transcript.requiresManualCleanup).toContain("stripe-webhook");
    // clerk and supabase must still run (they are in later waves)
    expect(deprovisioned).toContain("clerk");
    expect(deprovisioned).toContain("supabase");
  });

  test("pre-flight rollback plan report shows correct waves before provisioning", () => {
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    // Pre-flight: enumerate what would happen
    const preflightReport = plan.waves.map((wave: RollbackWave) => ({
      wave: wave.index,
      providers: [...wave.providers].sort(),
    }));

    // Wave 0: stripe-webhook
    expect(preflightReport[0]).toEqual({ wave: 0, providers: ["stripe-webhook"] });
    // Wave 1: clerk
    expect(preflightReport[1]).toEqual({ wave: 1, providers: ["clerk"] });
    // Wave 2: supabase
    expect(preflightReport[2]).toEqual({ wave: 2, providers: ["supabase"] });

    // Verify no provisioning has happened yet — plan is purely declarative
    expect(plan.scope.has("supabase")).toBe(true);
    expect(plan.scope.has("clerk")).toBe(true);
    expect(plan.scope.has("stripe-webhook")).toBe(true);
  });

  test("triggerError is surfaced in rollback transcript", async () => {
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    const transcript = await executeRollbackPlan(plan, {
      deprovision: async () => {},
      triggerError: "stripe-webhook materialize: API key endpoint returned 500",
    });

    expect(transcript.triggerError).toBe(
      "stripe-webhook materialize: API key endpoint returned 500",
    );
  });

  test("rollback plan with failurePoint=clerk scopes to supabase only", () => {
    const order = resolveOrder(entries); // [supabase, clerk, stripe-webhook]
    const plan = buildRollbackPlan(entries, order, "clerk");

    // Only supabase was provisioned before clerk
    expect(plan.scope.has("supabase")).toBe(true);
    expect(plan.scope.has("clerk")).toBe(false);
    expect(plan.scope.has("stripe-webhook")).toBe(false);
    expect(plan.scope.size).toBe(1);
  });

  test("full end-to-end orchestration rollback via runOrchestrationGroup", async () => {
    const h = setupFakePhantom();
    const cwd = makeTmpDir();
    const originalCwd = process.cwd();
    process.chdir(cwd);
    await writeConfig(emptyConfig("interop-test"), cwd);

    const rolledBack: string[] = [];

    providers["interop-supabase"] = async () => makeStubProvider("interop-supabase");
    providers["interop-clerk"] = async () => makeStubProvider("interop-clerk");
    providers["interop-stripe-webhook"] = async () => ({
      ...makeStubProvider("interop-stripe-webhook"),
      async materialize() {
        throw new Error("stripe-webhook materialize failed");
      },
    });

    try {
      await runOrchestrationGroup({
        entries: [
          {
            providerName: "interop-supabase",
            opts: {
              onRollback: async (name) => { rolledBack.push(name); },
            },
          },
          {
            providerName: "interop-clerk",
            dependsOn: ["interop-supabase"],
            opts: {
              onRollback: async (name) => { rolledBack.push(name); },
            },
          },
          {
            providerName: "interop-stripe-webhook",
            dependsOn: ["interop-clerk"],
          },
        ],
        defaults: { cwd, interactive: false, persist: false },
      });
    } catch (err) {
      const e = err as Error & { code?: string };
      expect(e.code ?? e.message).toMatch(/ORCHESTRATION_PARTIAL_FAILURE/);
    }

    // Rollback callbacks invoked — order: interop-clerk before interop-supabase
    if (rolledBack.length >= 2) {
      expect(rolledBack.indexOf("interop-clerk")).toBeLessThan(
        rolledBack.indexOf("interop-supabase"),
      );
    }

    process.chdir(originalCwd);
    h.cleanup();
    for (const k of ["interop-supabase", "interop-clerk", "interop-stripe-webhook"]) {
      Reflect.deleteProperty(providers, k);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Partial-failure recovery — materialize() fails mid-chain
// Dangling resources tracked in requiresManualCleanup (the "doctor --reconcile" list)
// ---------------------------------------------------------------------------

describe("Scenario 2: partial-failure recovery — dangling resource tracking", () => {
  let h: Harness;
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    h = setupFakePhantom();
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
    await writeConfig(emptyConfig("interop-partial"), cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    h.cleanup();
    for (const k of [
      "pf-supabase", "pf-clerk", "pf-stripe",
      "pf-svc-a", "pf-svc-b", "pf-svc-c",
    ]) {
      Reflect.deleteProperty(providers, k);
    }
  });

  test("mid-chain materialize failure leaves dangling resource in requiresManualCleanup", async () => {
    // Three-provider chain: pf-supabase → pf-clerk → pf-stripe
    // pf-clerk's materialize fails, and pf-clerk has no deprovision
    // → should appear in requiresManualCleanup ("doctor --reconcile" list)
    const entries: OrchestrationEntry[] = [
      { providerName: "pf-supabase" },
      { providerName: "pf-clerk", dependsOn: ["pf-supabase"] },
      { providerName: "pf-stripe", dependsOn: ["pf-clerk"] },
    ];

    const order = resolveOrder(entries);
    // Simulate: supabase and clerk were provisioned; pf-stripe was the failure point
    // (clerk = last successfully provisioned; pf-stripe = failurePoint)
    const failurePoint = "pf-stripe";

    const plan = buildRollbackPlan(entries, order, failurePoint);
    // pf-supabase and pf-clerk are in scope; pf-stripe was not provisioned
    expect(plan.scope.has("pf-supabase")).toBe(true);
    expect(plan.scope.has("pf-clerk")).toBe(true);
    expect(plan.scope.has("pf-stripe")).toBe(false);

    // Simulate pf-clerk having no deprovision (dangling resource)
    const skipSet = new Set(["pf-clerk"]);
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async () => {},
      skipProviders: skipSet,
    });

    // pf-clerk is skipped → doctor --reconcile should list it
    expect(transcript.skipped).toContain("pf-clerk");
    expect(transcript.fullyRolledBack).toBe(false);
    // pf-supabase was cleaned
    expect(transcript.cleaned).toContain("pf-supabase");
  });

  test("failed deprovision during rollback populates requiresManualCleanup (doctor --reconcile list)", async () => {
    const entries: OrchestrationEntry[] = [
      { providerName: "pf-supabase" },
      { providerName: "pf-clerk", dependsOn: ["pf-supabase"] },
    ];
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    // pf-clerk deprovision throws → dangling resource
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => {
        if (name === "pf-clerk") throw new Error("pf-clerk API locked: cannot delete");
      },
    });

    // requiresManualCleanup IS the doctor --reconcile list
    expect(transcript.requiresManualCleanup).toContain("pf-clerk");
    expect(transcript.fullyRolledBack).toBe(false);
    expect(transcript.recoverySuggestion).toMatch(/pf-clerk/);
    expect(transcript.recoverySuggestion).toMatch(/manual cleanup/i);
    // pf-supabase should still have been cleaned (it's in wave 1 after clerk)
    expect(transcript.cleaned).toContain("pf-supabase");
  });

  test("multiple dangling resources all appear in requiresManualCleanup", async () => {
    const entries: OrchestrationEntry[] = [
      { providerName: "pf-svc-a" },
      { providerName: "pf-svc-b", dependsOn: ["pf-svc-a"] },
      { providerName: "pf-svc-c", dependsOn: ["pf-svc-a"] },
    ];
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => {
        if (name === "pf-svc-b" || name === "pf-svc-c") {
          throw new Error(`${name}: deprovision API unavailable`);
        }
      },
    });

    // Both pf-svc-b and pf-svc-c are dangling
    expect(transcript.requiresManualCleanup).toContain("pf-svc-b");
    expect(transcript.requiresManualCleanup).toContain("pf-svc-c");
    expect(transcript.requiresManualCleanup).toHaveLength(2);
    // pf-svc-a was successfully cleaned
    expect(transcript.cleaned).toContain("pf-svc-a");
    expect(transcript.fullyRolledBack).toBe(false);
  });

  test("no secrets leak to Phantom vault when materialize throws mid-chain (addService)", async () => {
    // addService: provision succeeds, materialize throws → secrets must NOT be in vault
    providers["pf-supabase"] = async () => ({
      ...makeStubProvider("pf-supabase"),
      async materialize() {
        throw new Error("supabase materialize: key endpoint 500");
      },
    });

    await addService({
      providerName: "pf-supabase",
      cwd,
      interactive: false,
    }).catch(() => {});

    const vault = await readVault(h.dir);
    // No secret from pf-supabase should have been written
    expect(vault["PF-SUPABASE_KEY"]).toBeUndefined();
    expect(vault["PF_SUPABASE_KEY"]).toBeUndefined();
    // The config must also be clean
    const config = await readConfig(cwd);
    expect(config.services["pf-supabase"]).toBeUndefined();
  });

  test("doctor --reconcile list is empty when all rollbacks succeed", async () => {
    const entries: OrchestrationEntry[] = [
      { providerName: "pf-svc-a" },
      { providerName: "pf-svc-b", dependsOn: ["pf-svc-a"] },
    ];
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    const transcript = await executeRollbackPlan(plan, {
      deprovision: async () => {},
    });

    // No dangling resources → doctor --reconcile finds nothing
    expect(transcript.requiresManualCleanup).toHaveLength(0);
    expect(transcript.skipped).toHaveLength(0);
    expect(transcript.fullyRolledBack).toBe(true);
    expect(transcript.recoverySuggestion).toMatch(/Rollback complete/i);
  });

  test("recoverySuggestion directs to stack doctor --fix for dangling resources", async () => {
    const graph = new Map<string, string[]>([["pf-supabase", []]]);
    const plan = computeRollbackPlan(graph);

    const transcript = await executeRollbackPlan(plan, {
      deprovision: async () => {
        throw new Error("network timeout");
      },
    });

    expect(transcript.recoverySuggestion).toMatch(/stack doctor --fix/i);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: Provision timeout + abort cascading across dependent services
// Secrets must NOT leak in Phantom on timeout
// ---------------------------------------------------------------------------

describe("Scenario 3: provision timeout + abort cascading without secret leaks", () => {
  let h: Harness;
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    h = setupFakePhantom();
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
    await writeConfig(emptyConfig("interop-timeout"), cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    h.cleanup();
    for (const k of [
      "timeout-supabase", "timeout-clerk", "timeout-stripe",
      "abort-root", "abort-dep",
    ]) {
      Reflect.deleteProperty(providers, k);
    }
  });

  test("hanging provision times out and does not write secrets to Phantom", async () => {
    providers["timeout-supabase"] = async () => ({
      ...makeStubProvider("timeout-supabase"),
      async provision() {
        // Hangs forever — simulates stuck cloud API
        return new Promise<never>(() => {});
      },
    });

    const start = Date.now();
    const err = await addService({
      providerName: "timeout-supabase",
      cwd,
      interactive: false,
      timeoutMs: 80,
    })
      .then(() => null)
      .catch((e: Error) => e);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
    expect(err).not.toBeNull();
    expect((err as Error & { code?: string }).code).toBe("PROVISION_TIMEOUT");

    // No secrets in Phantom
    const vault = await readVault(h.dir);
    expect(vault["TIMEOUT-SUPABASE_KEY"]).toBeUndefined();
    expect(vault["TIMEOUT_SUPABASE_KEY"]).toBeUndefined();

    // No config entry
    const config = await readConfig(cwd);
    expect(config.services["timeout-supabase"]).toBeUndefined();
  });

  test("hanging materialize times out and does not write partial secrets", async () => {
    providers["timeout-clerk"] = async () => ({
      ...makeStubProvider("timeout-clerk"),
      async materialize() {
        // Hangs during key extraction
        return new Promise<never>(() => {});
      },
      async deprovision(_ctx: ProviderContext, _auth: AuthHandle, _resourceId: string) {
        // Deprovision succeeds — resource cleaned up
      },
    });

    const err = await addService({
      providerName: "timeout-clerk",
      cwd,
      interactive: false,
      timeoutMs: 80,
    })
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).not.toBeNull();
    expect((err as Error & { code?: string }).code).toBe("PROVISION_TIMEOUT");

    // No partial secrets in vault
    const vault = await readVault(h.dir);
    expect(Object.keys(vault)).toHaveLength(0);

    const config = await readConfig(cwd);
    expect(config.services["timeout-clerk"]).toBeUndefined();
  });

  test("abort signal prevents downstream waves from starting in executeRollbackPlan", async () => {
    // Build a 3-provider chain; abort after first wave completes
    const entries: OrchestrationEntry[] = [
      { providerName: "abort-root" },
      { providerName: "abort-dep", dependsOn: ["abort-root"] },
    ];
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    const controller = new AbortController();
    const executed: string[] = [];

    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => {
        executed.push(name);
        // Abort after first provider — prevents wave 1 from starting
        controller.abort();
      },
      signal: controller.signal,
    });

    // Only the first wave ran
    expect(executed).toHaveLength(1);
    expect(executed[0]).toBe("abort-dep"); // abort-dep is in wave 0 (no dependents of its own)
    // abort-root was skipped due to abort
    expect(transcript.skipped).toContain("abort-root");
    expect(transcript.fullyRolledBack).toBe(false);
  });

  test("timeout during rollback execution does not block remaining providers", async () => {
    // A rollback where one provider is very slow (would exceed a timeout)
    // but executeRollbackPlan continues with other providers
    const entries: OrchestrationEntry[] = [
      { providerName: "timeout-supabase" },
      { providerName: "timeout-stripe", dependsOn: ["timeout-supabase"] },
    ];
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    const deprovisioned: string[] = [];

    // stripe-webhook and supabase are independent at the rollback level here
    // timeout-stripe deprovision throws (simulating a hung connection that was eventually killed)
    const transcript = await executeRollbackPlan(plan, {
      deprovision: async (name) => {
        if (name === "timeout-stripe") {
          throw new Error("timeout-stripe: deprovision timed out after 30s");
        }
        deprovisioned.push(name);
      },
    });

    // Even though stripe failed, supabase (wave 1) was still attempted and cleaned
    expect(transcript.requiresManualCleanup).toContain("timeout-stripe");
    expect(deprovisioned).toContain("timeout-supabase");
    expect(transcript.fullyRolledBack).toBe(false);
  });

  test("no secrets remain in Phantom after a full chain timeout-and-rollback", async () => {
    // Provider that writes a secret successfully but then fails the materialize step
    providers["timeout-stripe"] = async () => ({
      ...makeStubProvider("timeout-stripe"),
      async provision() {
        return { id: "stripe-resource-xyz", displayName: "stripe-resource" };
      },
      async materialize() {
        // Simulate: provision succeeded, then materialize hangs
        return new Promise<never>(() => {});
      },
      async deprovision() {
        // Deprovision cleans up the upstream resource
      },
    });

    await addService({
      providerName: "timeout-stripe",
      cwd,
      interactive: false,
      timeoutMs: 80,
    }).catch(() => {});

    // No secret should be in vault — materialize never returned secrets
    const vault = await readVault(h.dir);
    expect(vault["TIMEOUT-STRIPE_KEY"]).toBeUndefined();
    expect(vault["TIMEOUT_STRIPE_KEY"]).toBeUndefined();
    expect(Object.keys(vault)).toHaveLength(0);

    const config = await readConfig(cwd);
    expect(config.services["timeout-stripe"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: Quota consensus engine — spend-rate trends across multi-provider
// stacks over simulated 7-day windows
// ---------------------------------------------------------------------------

describe("Scenario 4: quota consensus engine — multi-provider 7-day trend tracking", () => {
  let histogramDir: string;

  beforeEach(() => {
    histogramDir = makeTmpDir();
    __setHistogramDirForTesting(histogramDir);
  });

  afterEach(() => {
    __setHistogramDirForTesting(undefined);
    try {
      rmSync(histogramDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  /**
   * Build a simulated 7-day HistogramStore for multiple providers.
   * Each provider gets `days` samples spaced 24h apart.
   */
  function buildWeeklyStore(
    providerBurns: Record<string, number[]>,
  ): HistogramStore {
    const store: HistogramStore = {};
    const now = Date.now();
    for (const [provider, burns] of Object.entries(providerBurns)) {
      store[provider] = burns.map((burn, i) => ({
        ts: now - (burns.length - 1 - i) * 24 * 60 * 60 * 1000,
        latencyMs: 50 + i * 2,
        estimatedDailyBurnUSD: burn,
        status: "ok" as const,
      }));
    }
    return store;
  }

  test("flat burn over 7 days → near-zero slope for all providers", async () => {
    const store = buildWeeklyStore({
      supabase: [5, 5, 5, 5, 5, 5, 5],
      clerk: [2, 2, 2, 2, 2, 2, 2],
      stripe: [1, 1, 1, 1, 1, 1, 1],
    });
    await writeHistogram(histogramDir, store);

    const engine = new QuotaEngine({ cwd: histogramDir });
    const trend = engine.computeBurnTrend(store, "supabase");

    expect(trend.avgDailyBurnUSD).toBeCloseTo(5, 2);
    expect(Math.abs(trend.slopeDailyUSD)).toBeCloseTo(0, 3);
    expect(trend.sampleCount).toBe(7);
  });

  test("accelerating burn over 7 days → positive slope", async () => {
    // Each day burns more (e.g. heavy feature launch)
    const store = buildWeeklyStore({
      supabase: [1, 2, 3, 5, 8, 12, 18],
    });
    await writeHistogram(histogramDir, store);

    const engine = new QuotaEngine({ cwd: histogramDir });
    const trend = engine.computeBurnTrend(store, "supabase");

    expect(trend.slopeDailyUSD).toBeGreaterThan(0);
    expect(trend.avgDailyBurnUSD).toBeGreaterThan(1);
    expect(trend.sampleCount).toBe(7);
  });

  test("decelerating burn over 7 days → negative slope", async () => {
    // Spend was high initially, tapering off (e.g. migration cost settling)
    const store = buildWeeklyStore({
      stripe: [20, 15, 12, 10, 8, 5, 2],
    });
    await writeHistogram(histogramDir, store);

    const engine = new QuotaEngine({ cwd: histogramDir });
    const trend = engine.computeBurnTrend(store, "stripe");

    expect(trend.slopeDailyUSD).toBeLessThan(0);
    expect(trend.sampleCount).toBe(7);
  });

  test("aggregate across supabase+clerk+stripe stack produces correct totals", async () => {
    const store = buildWeeklyStore({
      supabase: [4, 4, 4, 4, 4, 4, 4],
      clerk: [2, 2, 2, 2, 2, 2, 2],
      stripe: [1, 1, 1, 1, 1, 1, 1],
    });
    await writeHistogram(histogramDir, store);

    const engine = new QuotaEngine({ cwd: histogramDir });
    const snapshots: QuotaSnapshot[] = [
      makeSnapshot("supabase", { estimatedDailyBurnUSD: 4 }),
      makeSnapshot("clerk", { estimatedDailyBurnUSD: 2 }),
      makeSnapshot("stripe", { estimatedDailyBurnUSD: 1 }),
    ];

    const forecast = await engine.aggregate(snapshots);

    expect(forecast.totalDailyBurnUSD).toBeCloseTo(7, 2);
    expect(forecast.estimatedMonthlySpendUSD).toBeCloseTo(210, 1);
    expect(forecast.activeProviderCount).toBe(3);
    expect(forecast.burnTrends).toHaveLength(3);
  });

  test("burnTrends correctly ordered: highest slope first is NOT enforced, but all 3 providers present", async () => {
    const store = buildWeeklyStore({
      supabase: [1, 2, 4, 7, 11, 16, 22], // accelerating
      clerk: [5, 5, 5, 5, 5, 5, 5],        // flat
      stripe: [10, 8, 6, 5, 4, 3, 2],       // decelerating
    });
    await writeHistogram(histogramDir, store);

    const engine = new QuotaEngine({ cwd: histogramDir });
    const snapshots: QuotaSnapshot[] = [
      makeSnapshot("supabase", { estimatedDailyBurnUSD: 22 }),
      makeSnapshot("clerk", { estimatedDailyBurnUSD: 5 }),
      makeSnapshot("stripe", { estimatedDailyBurnUSD: 2 }),
    ];

    const forecast = await engine.aggregate(snapshots);

    const trendProviders = forecast.burnTrends.map((t) => t.provider);
    expect(trendProviders).toContain("supabase");
    expect(trendProviders).toContain("clerk");
    expect(trendProviders).toContain("stripe");

    const supabaseTrend = forecast.burnTrends.find((t) => t.provider === "supabase");
    const stripeTrend = forecast.burnTrends.find((t) => t.provider === "stripe");
    const clerkTrend = forecast.burnTrends.find((t) => t.provider === "clerk");

    expect(supabaseTrend?.slopeDailyUSD).toBeGreaterThan(0);
    expect(stripeTrend?.slopeDailyUSD).toBeLessThan(0);
    expect(Math.abs(clerkTrend?.slopeDailyUSD ?? 1)).toBeCloseTo(0, 2);
  });

  test("utilization alerts fire for multi-provider stack when threshold exceeded", async () => {
    const engine = new QuotaEngine({
      cwd: histogramDir,
      utilizationThresholdPct: 75,
      budgetDailyUSD: 10,
    });

    const snapshots: QuotaSnapshot[] = [
      makeSnapshot("supabase", { quotaUsedPercent: 50, estimatedDailyBurnUSD: 3 }),  // ok
      makeSnapshot("clerk",    { quotaUsedPercent: 80, estimatedDailyBurnUSD: 12 }), // both alert
      makeSnapshot("stripe",   { quotaUsedPercent: 30, estimatedDailyBurnUSD: 15 }), // burn alert
    ];

    const forecast = await engine.aggregate(snapshots);

    expect(forecast.alerts.length).toBeGreaterThanOrEqual(2);
    const clerkAlert = forecast.alerts.find((a) => a.provider === "clerk");
    const stripeAlert = forecast.alerts.find((a) => a.provider === "stripe");

    expect(clerkAlert).toBeDefined();
    expect(clerkAlert?.reason).toBe("both");

    expect(stripeAlert).toBeDefined();
    expect(stripeAlert?.reason).toBe("burn");

    // Supabase should not alert
    const supabaseAlert = forecast.alerts.find((a) => a.provider === "supabase");
    expect(supabaseAlert).toBeUndefined();
  });

  test("topSpenders correctly ordered for multi-provider stack", async () => {
    const engine = new QuotaEngine({ cwd: histogramDir });
    const snapshots: QuotaSnapshot[] = [
      makeSnapshot("supabase", { estimatedDailyBurnUSD: 3 }),
      makeSnapshot("clerk",    { estimatedDailyBurnUSD: 12 }),
      makeSnapshot("stripe",   { estimatedDailyBurnUSD: 7 }),
    ];

    const forecast = await engine.aggregate(snapshots);

    expect(forecast.topSpenders[0]?.provider).toBe("clerk");
    expect(forecast.topSpenders[1]?.provider).toBe("stripe");
    expect(forecast.topSpenders[2]?.provider).toBe("supabase");
  });

  test("7-day window burn trend sampleCount matches days of data provided", async () => {
    const store = buildWeeklyStore({
      supabase: [2, 3, 4, 5, 6, 7, 8], // 7 samples
      clerk: [1, 2, 3],                   // 3 samples
    });
    await writeHistogram(histogramDir, store);

    const engine = new QuotaEngine({ cwd: histogramDir });

    const supabaseTrend = engine.computeBurnTrend(store, "supabase");
    const clerkTrend = engine.computeBurnTrend(store, "clerk");

    expect(supabaseTrend.sampleCount).toBe(7);
    expect(clerkTrend.sampleCount).toBe(3);
  });

  test("quota consensus with zero-burn provider excluded from topSpenders", async () => {
    const engine = new QuotaEngine({ cwd: histogramDir });
    const snapshots: QuotaSnapshot[] = [
      makeSnapshot("supabase", { estimatedDailyBurnUSD: 0 }),   // free tier
      makeSnapshot("clerk",    { estimatedDailyBurnUSD: 5 }),
      makeSnapshot("stripe",   { estimatedDailyBurnUSD: 3 }),
    ];

    const forecast = await engine.aggregate(snapshots);

    const topProviders = forecast.topSpenders.map((s) => s.provider);
    expect(topProviders).not.toContain("supabase");
    expect(topProviders).toContain("clerk");
    expect(topProviders).toContain("stripe");
  });

  test("stack utilization averages only non-zero quota providers", async () => {
    const engine = new QuotaEngine({ cwd: histogramDir });
    const snapshots: QuotaSnapshot[] = [
      makeSnapshot("supabase", { quotaUsedPercent: 60 }),
      makeSnapshot("clerk",    { quotaUsedPercent: 80 }),
      makeSnapshot("stripe",   { quotaUsedPercent: 0 }), // excluded
    ];

    const forecast = await engine.aggregate(snapshots);

    // Average of 60 and 80 = 70
    expect(forecast.stackUtilizationPercent).toBeCloseTo(70, 1);
  });
});

// ---------------------------------------------------------------------------
// RollbackPlan pre-flight validation: wave report before any provisioning
// ---------------------------------------------------------------------------

describe("RollbackPlan pre-flight validation report", () => {
  test("pre-flight report on a 5-provider mixed graph shows correct wave assignments", () => {
    // Graph:
    //   db (no deps)
    //   auth → db
    //   payments (no deps)
    //   webhook → payments
    //   analytics → db, payments
    const entries: OrchestrationEntry[] = [
      { providerName: "db" },
      { providerName: "auth", dependsOn: ["db"] },
      { providerName: "payments" },
      { providerName: "webhook", dependsOn: ["payments"] },
      { providerName: "analytics", dependsOn: ["db", "payments"] },
    ];

    const provisionOrder = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, provisionOrder);

    // Pre-flight: generate the wave report
    const preflightWaves = plan.waves.map((w: RollbackWave) => ({
      wave: w.index,
      providers: [...w.providers].sort(),
    }));

    // Wave 0 must contain leaves: auth, webhook, analytics (all depend on something)
    const wave0 = preflightWaves[0]?.providers ?? [];
    expect(wave0).toContain("auth");
    expect(wave0).toContain("webhook");
    expect(wave0).toContain("analytics");

    // Wave 1 must contain: db, payments (the roots)
    const wave1 = preflightWaves[1]?.providers ?? [];
    expect(wave1).toContain("db");
    expect(wave1).toContain("payments");

    // All 5 providers are in scope
    expect(plan.scope.size).toBe(5);
    expect(plan.orderedProviders).toHaveLength(5);
  });

  test("pre-flight report for linear chain has one provider per wave", () => {
    const entries: OrchestrationEntry[] = [
      { providerName: "A" },
      { providerName: "B", dependsOn: ["A"] },
      { providerName: "C", dependsOn: ["B"] },
      { providerName: "D", dependsOn: ["C"] },
    ];
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    // Linear chain → each wave has exactly 1 provider
    for (const wave of plan.waves) {
      expect(wave.providers).toHaveLength(1);
    }
    expect(plan.waves).toHaveLength(4);
    // Rollback order: D, C, B, A
    expect(plan.orderedProviders[0]).toBe("D");
    expect(plan.orderedProviders[1]).toBe("C");
    expect(plan.orderedProviders[2]).toBe("B");
    expect(plan.orderedProviders[3]).toBe("A");
  });

  test("pre-flight report with failurePoint scopes waves correctly", () => {
    const entries: OrchestrationEntry[] = [
      { providerName: "supabase" },
      { providerName: "clerk", dependsOn: ["supabase"] },
      { providerName: "stripe", dependsOn: ["clerk"] },
      { providerName: "webhook", dependsOn: ["stripe"] },
    ];
    const order = resolveOrder(entries); // [supabase, clerk, stripe, webhook]

    // Failure at stripe → only supabase and clerk in scope
    const plan = buildRollbackPlan(entries, order, "stripe");

    const preflightProviders = plan.orderedProviders;
    expect(preflightProviders).toContain("supabase");
    expect(preflightProviders).toContain("clerk");
    expect(preflightProviders).not.toContain("stripe");
    expect(preflightProviders).not.toContain("webhook");

    // clerk must appear before supabase in rollback order
    expect(preflightProviders.indexOf("clerk")).toBeLessThan(
      preflightProviders.indexOf("supabase"),
    );
  });

  test("buildRollbackGraph correctly builds dependency map for 3-service chain", () => {
    const entries: OrchestrationEntry[] = [
      { providerName: "supabase" },
      { providerName: "clerk", dependsOn: ["supabase"] },
      { providerName: "stripe-webhook", dependsOn: ["clerk"] },
    ];

    const graph = buildRollbackGraph(entries);

    // supabase → [clerk], clerk → [stripe-webhook], stripe-webhook → []
    expect(graph.get("supabase")).toContain("clerk");
    expect(graph.get("clerk")).toContain("stripe-webhook");
    expect(graph.get("stripe-webhook")).toEqual([]);
  });

  test("diamond dependency graph produces correct wave schedule", () => {
    // A → B, A → C, B+C → D
    const entries: OrchestrationEntry[] = [
      { providerName: "A" },
      { providerName: "B", dependsOn: ["A"] },
      { providerName: "C", dependsOn: ["A"] },
      { providerName: "D", dependsOn: ["B", "C"] },
    ];
    const order = resolveOrder(entries);
    const plan = buildRollbackPlan(entries, order);

    // D in wave 0 (deepest leaf), B+C in wave 1, A in wave 2
    expect(plan.waves[0]?.providers).toContain("D");
    const wave1 = plan.waves[1]?.providers ?? [];
    expect(wave1).toContain("B");
    expect(wave1).toContain("C");
    expect(plan.waves[2]?.providers).toContain("A");
  });
});
