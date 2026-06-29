import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, writeConfig } from "../config.ts";
import {
  FileCollector,
  Instrumentation,
  MemoryCollector,
  instrumentation,
} from "../instrumentation.ts";
import { addService } from "../pipeline.ts";
import type { Provider } from "../providers/_base.ts";
import { providers } from "../providers/index.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

// ---------------------------------------------------------------------------
// Unit tests: Instrumentation class + collectors
// ---------------------------------------------------------------------------

describe("Instrumentation.recordStep", () => {
  test("emits a step event with correct shape", () => {
    const mem = new MemoryCollector();
    const inst = new Instrumentation();
    inst.attach(mem);

    const before = Date.now();
    inst.recordStep("login", "supabase", 42, "success");
    const after = Date.now();

    expect(mem.events).toHaveLength(1);
    const ev = mem.events[0];
    expect(ev.type).toBe("step");
    if (ev.type !== "step") return;
    expect(ev.stepName).toBe("login");
    expect(ev.providerName).toBe("supabase");
    expect(ev.durationMs).toBe(42);
    expect(ev.status).toBe("success");
    expect(ev.timestamp).toBeGreaterThanOrEqual(before);
    expect(ev.timestamp).toBeLessThanOrEqual(after);
    expect(new Date(ev.time).toISOString()).toBe(ev.time);
    expect(ev.error).toBeUndefined();
    expect(ev.errorCode).toBeUndefined();
  });

  test("includes error and errorCode on failure", () => {
    const mem = new MemoryCollector();
    const inst = new Instrumentation();
    inst.attach(mem);

    inst.recordStep("provision", "neon", 0, "failure", "HTTP 500", "PROVISION_TIMEOUT");

    const ev = mem.events[0];
    expect(ev.type).toBe("step");
    if (ev.type !== "step") return;
    expect(ev.status).toBe("failure");
    expect(ev.error).toBe("HTTP 500");
    expect(ev.errorCode).toBe("PROVISION_TIMEOUT");
  });

  test("timeout status is captured", () => {
    const mem = new MemoryCollector();
    const inst = new Instrumentation();
    inst.attach(mem);

    inst.recordStep("materialize", "vercel", 30000, "timeout", "timed out");

    const ev = mem.events[0];
    if (ev.type !== "step") return;
    expect(ev.status).toBe("timeout");
    expect(ev.durationMs).toBe(30000);
  });

  test("no-ops when no collector is attached", () => {
    const inst = new Instrumentation();
    // Should not throw
    expect(() => inst.recordStep("login", "stripe", 10, "success")).not.toThrow();
  });

  test("active returns false with no collector", () => {
    const inst = new Instrumentation();
    expect(inst.active).toBe(false);
    inst.attach(new MemoryCollector());
    expect(inst.active).toBe(true);
    inst.detach();
    expect(inst.active).toBe(false);
  });
});

describe("Instrumentation.recordRollback", () => {
  test("rollback event includes provider, resource_id, reason, cleaned, failed", () => {
    const mem = new MemoryCollector();
    const inst = new Instrumentation();
    inst.attach(mem);

    inst.recordRollback(
      "railway",
      "res-abc-123",
      "materialize exploded",
      [{ kind: "secret", id: "RAILWAY_TOKEN" }],
      [{ kind: "upstream_resource", id: "res-abc-123", error: "API 503" }],
      "Delete res-abc-123 manually on the Railway dashboard.",
    );

    expect(mem.events).toHaveLength(1);
    const ev = mem.events[0];
    expect(ev.type).toBe("rollback");
    if (ev.type !== "rollback") return;
    expect(ev.providerName).toBe("railway");
    expect(ev.resourceId).toBe("res-abc-123");
    expect(ev.reason).toBe("materialize exploded");
    expect(ev.cleaned).toHaveLength(1);
    expect(ev.cleaned[0].kind).toBe("secret");
    expect(ev.cleaned[0].id).toBe("RAILWAY_TOKEN");
    expect(ev.failed).toHaveLength(1);
    expect(ev.failed[0].kind).toBe("upstream_resource");
    expect(ev.failed[0].error).toBe("API 503");
    expect(ev.recoverySuggestion).toContain("Railway dashboard");
  });
});

describe("Instrumentation.recordPartialFailure", () => {
  test("partial failure event has recovery suggestion and partial state", () => {
    const mem = new MemoryCollector();
    const inst = new Instrumentation();
    inst.attach(mem);

    inst.recordPartialFailure(
      "stripe",
      "materialize",
      "webhook creation failed",
      "ADD_SERVICE_PARTIAL_FAILURE",
      [
        { kind: "upstream_resource", id: "acct_123", written: true },
        { kind: "secret", id: "STRIPE_SECRET_KEY", written: true },
      ],
      "Delete acct_123 on Stripe dashboard then run `stack doctor --fix`.",
    );

    expect(mem.events).toHaveLength(1);
    const ev = mem.events[0];
    expect(ev.type).toBe("partial_failure");
    if (ev.type !== "partial_failure") return;
    expect(ev.providerName).toBe("stripe");
    expect(ev.failedAt).toBe("materialize");
    expect(ev.error).toBe("webhook creation failed");
    expect(ev.errorCode).toBe("ADD_SERVICE_PARTIAL_FAILURE");
    expect(ev.partialState).toHaveLength(2);
    expect(ev.recoverySuggestion).toContain("stack doctor --fix");
  });
});

describe("Instrumentation.recordOrchestrationStep", () => {
  test("orchestration step event shape is correct", () => {
    const mem = new MemoryCollector();
    const inst = new Instrumentation();
    inst.attach(mem);

    inst.recordOrchestrationStep("supabase", 0, 1200, "success");
    inst.recordOrchestrationStep("openai", 1, 0, "failure", "API key invalid");

    expect(mem.events).toHaveLength(2);

    const ev0 = mem.events[0];
    expect(ev0.type).toBe("orchestration_step");
    if (ev0.type !== "orchestration_step") return;
    expect(ev0.providerName).toBe("supabase");
    expect(ev0.wave).toBe(0);
    expect(ev0.durationMs).toBe(1200);
    expect(ev0.status).toBe("success");
    expect(ev0.error).toBeUndefined();

    const ev1 = mem.events[1];
    if (ev1.type !== "orchestration_step") return;
    expect(ev1.providerName).toBe("openai");
    expect(ev1.wave).toBe(1);
    expect(ev1.status).toBe("failure");
    expect(ev1.error).toBe("API key invalid");
  });
});

describe("MemoryCollector", () => {
  test("toJson serializes all events as a JSON object with an events array", () => {
    const mem = new MemoryCollector();
    const inst = new Instrumentation();
    inst.attach(mem);
    inst.recordStep("login", "github", 55, "success");

    const json = JSON.parse(mem.toJson()) as { events: unknown[] };
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.events).toHaveLength(1);
  });

  test("collector errors are swallowed — instrumentation never throws", () => {
    const inst = new Instrumentation();
    inst.attach({
      collect() {
        throw new Error("collector exploded");
      },
    });
    // Must not throw
    expect(() => inst.recordStep("login", "vercel", 10, "success")).not.toThrow();
  });
});

describe("FileCollector", () => {
  test("flush writes all events to the specified file as valid JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stack-trace-"));
    const filePath = join(dir, "trace.json");

    const fc = new FileCollector(filePath);
    const inst = new Instrumentation();
    inst.attach(fc);

    inst.recordStep("login", "posthog", 22, "success");
    inst.recordStep("provision", "posthog", 88, "success");

    await inst.flush();
    inst.detach();

    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { events: unknown[] };
    expect(Array.isArray(parsed.events)).toBe(true);
    expect(parsed.events).toHaveLength(2);
  });

  test("flush creates parent directories that do not exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stack-trace-"));
    const filePath = join(dir, "nested", "deep", "trace.json");

    const fc = new FileCollector(filePath);
    fc.collect({
      type: "step",
      timestamp: Date.now(),
      time: new Date().toISOString(),
      stepName: "login",
      providerName: "sendgrid",
      durationMs: 5,
      status: "success",
    });
    await fc.flush();

    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { events: unknown[] };
    expect(parsed.events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: pipeline instrumentation via addService()
// ---------------------------------------------------------------------------

describe("pipeline instrumentation — addService wires step events", () => {
  let h: Harness;
  let cwd: string;
  let originalCwd: string;
  let mem: MemoryCollector;

  beforeEach(async () => {
    h = setupFakePhantom();
    cwd = mkdtempSync(join(tmpdir(), "stack-inst-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
    await writeConfig(emptyConfig("test-template"), cwd);

    mem = new MemoryCollector();
    instrumentation.attach(mem);
  });

  afterEach(() => {
    instrumentation.detach();
    process.chdir(originalCwd);
    h.cleanup();
  });

  test("successful addService emits login, provision, materialize step events", async () => {
    const provider: Provider = {
      name: "inst-happy",
      displayName: "Inst Happy",
      category: "database",
      authKind: "api_key",
      async login() { return { token: "tok" }; },
      async provision() { return { id: "res-inst-1", displayName: "db" }; },
      async materialize() { return { secrets: { INST_KEY: "val" } }; },
    };
    providers["inst-happy"] = async () => provider;

    await addService({ providerName: "inst-happy", cwd, interactive: false });

    const stepEvents = mem.events.filter((e) => e.type === "step");
    const stepNames = stepEvents.map((e) => (e as { stepName: string }).stepName);
    expect(stepNames).toContain("login");
    expect(stepNames).toContain("provision");
    expect(stepNames).toContain("materialize");

    for (const ev of stepEvents) {
      if (ev.type !== "step") continue;
      expect(ev.status).toBe("success");
      expect(typeof ev.durationMs).toBe("number");
      expect(ev.durationMs).toBeGreaterThanOrEqual(0);
      expect(ev.providerName).toBe("inst-happy");
    }

    Reflect.deleteProperty(providers, "inst-happy");
  });

  test("failed materialize emits failure step event and rollback event", async () => {
    const provider: Provider = {
      name: "inst-fail",
      displayName: "Inst Fail",
      category: "database",
      authKind: "api_key",
      async login() { return { token: "tok" }; },
      async provision() { return { id: "res-inst-fail", displayName: "db" }; },
      async materialize() { throw new Error("mat exploded"); },
      async deprovision() { /* no-op */ },
    };
    providers["inst-fail"] = async () => provider;

    await addService({ providerName: "inst-fail", cwd, interactive: false }).catch(() => {});

    // materialize step should be failure
    const matStep = mem.events.find(
      (e) => e.type === "step" && (e as { stepName: string }).stepName === "materialize",
    );
    expect(matStep).toBeDefined();
    if (matStep?.type === "step") {
      expect(matStep.status).toBe("failure");
      expect(matStep.error).toContain("mat exploded");
    }

    // deprovision step should be success
    const deprovStep = mem.events.find(
      (e) => e.type === "step" && (e as { stepName: string }).stepName === "deprovision",
    );
    expect(deprovStep).toBeDefined();
    if (deprovStep?.type === "step") {
      expect(deprovStep.status).toBe("success");
    }

    // rollback event should be emitted
    const rollbackEv = mem.events.find((e) => e.type === "rollback");
    expect(rollbackEv).toBeDefined();
    if (rollbackEv?.type === "rollback") {
      expect(rollbackEv.providerName).toBe("inst-fail");
      expect(rollbackEv.resourceId).toBe("res-inst-fail");
      expect(rollbackEv.reason).toContain("mat exploded");
    }

    Reflect.deleteProperty(providers, "inst-fail");
  });

  test("provider without deprovision emits partial_failure event", async () => {
    const provider: Provider = {
      name: "inst-nodep",
      displayName: "Inst NoDep",
      category: "database",
      authKind: "api_key",
      async login() { return { token: "tok" }; },
      async provision() { return { id: "res-inst-nodep", displayName: "db" }; },
      async materialize() { throw new Error("boom no dep"); },
      // no deprovision
    };
    providers["inst-nodep"] = async () => provider;

    await addService({ providerName: "inst-nodep", cwd, interactive: false }).catch(() => {});

    const partialEv = mem.events.find((e) => e.type === "partial_failure");
    expect(partialEv).toBeDefined();
    if (partialEv?.type === "partial_failure") {
      expect(partialEv.providerName).toBe("inst-nodep");
      expect(partialEv.recoverySuggestion).toContain("stack doctor --fix");
      expect(partialEv.partialState.some((s) => s.kind === "upstream_resource")).toBe(true);
    }

    // rollback event also emitted with failed upstream_resource
    const rollbackEv = mem.events.find((e) => e.type === "rollback");
    expect(rollbackEv).toBeDefined();
    if (rollbackEv?.type === "rollback") {
      expect(rollbackEv.failed.some((f) => f.kind === "upstream_resource")).toBe(true);
    }

    Reflect.deleteProperty(providers, "inst-nodep");
  });
});

// ---------------------------------------------------------------------------
// Integration test: multi-provider orchestration audit trail
// ---------------------------------------------------------------------------

describe("multi-provider orchestration generates audit trail", () => {
  let h: Harness;
  let cwd: string;
  let originalCwd: string;
  let mem: MemoryCollector;

  beforeEach(async () => {
    h = setupFakePhantom();
    cwd = mkdtempSync(join(tmpdir(), "stack-orch-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
    await writeConfig(emptyConfig("test-template"), cwd);

    mem = new MemoryCollector();
    instrumentation.attach(mem);
  });

  afterEach(() => {
    instrumentation.detach();
    process.chdir(originalCwd);
    h.cleanup();
  });

  test("two sequential providers each emit step events under their own providerName", async () => {
    const makeProvider = (name: string): Provider => ({
      name,
      displayName: name,
      category: "database",
      authKind: "api_key",
      async login() { return { token: "tok" }; },
      async provision() { return { id: `res-${name}`, displayName: name }; },
      async materialize() { return { secrets: { [`${name.toUpperCase()}_KEY`]: "val" } }; },
    });

    providers["orch-alpha"] = async () => makeProvider("orch-alpha");
    providers["orch-beta"] = async () => makeProvider("orch-beta");

    const { runOrchestrationGroup } = await import("../orchestration.ts");
    await runOrchestrationGroup({
      entries: [
        { providerName: "orch-alpha" },
        { providerName: "orch-beta", dependsOn: ["orch-alpha"] },
      ],
      defaults: { cwd, interactive: false },
    });

    const stepEvents = mem.events.filter((e) => e.type === "step");
    const alphaSteps = stepEvents.filter(
      (e) => (e as { providerName: string }).providerName === "orch-alpha",
    );
    const betaSteps = stepEvents.filter(
      (e) => (e as { providerName: string }).providerName === "orch-beta",
    );

    // Each provider should have login + provision + materialize
    expect(alphaSteps.length).toBeGreaterThanOrEqual(3);
    expect(betaSteps.length).toBeGreaterThanOrEqual(3);

    // All steps should be success
    for (const ev of stepEvents) {
      if (ev.type === "step") {
        expect(ev.status).toBe("success");
      }
    }

    // Timestamps should be monotonically non-decreasing
    const timestamps = stepEvents.map((e) => (e as { timestamp: number }).timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1] - 1); // allow 1ms skew
    }

    Reflect.deleteProperty(providers, "orch-alpha");
    Reflect.deleteProperty(providers, "orch-beta");
  });

  test("audit trail captures correct durationMs values (all non-negative)", async () => {
    const provider: Provider = {
      name: "orch-timing",
      displayName: "Orch Timing",
      category: "ai",
      authKind: "api_key",
      async login() { return { token: "tok" }; },
      async provision() { return { id: "res-timing", displayName: "timing" }; },
      async materialize() { return { secrets: { TIMING_KEY: "v" } }; },
    };
    providers["orch-timing"] = async () => provider;

    await addService({ providerName: "orch-timing", cwd, interactive: false });

    const stepEvents = mem.events.filter((e) => e.type === "step");
    for (const ev of stepEvents) {
      if (ev.type === "step") {
        expect(ev.durationMs).toBeGreaterThanOrEqual(0);
      }
    }

    Reflect.deleteProperty(providers, "orch-timing");
  });
});
