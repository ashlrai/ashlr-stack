/**
 * provision-readiness.test.ts
 *
 * Comprehensive test suite for the Provider Readiness Gate framework
 * (packages/core/src/provision-readiness.ts).
 *
 * Coverage areas:
 *   (1) Registry — register / retrieve / list
 *   (2) runReadinessChecks — hard + soft logic, empty results
 *   (3) enforceReadiness — pipeline integration, throws on hard failure, logs advisories
 *   (4) validateAllProviders — batch mode for `stack validate`
 *   (5) generateReadinessJson / generateAllReadinessJson — codegen descriptors
 *   (6) ProviderNotReadyError — error shape
 *   (7) Built-in provider rules: Vercel, Stripe, Supabase, Neon, GitHub, Anthropic, OpenAI, AWS
 *       — real API scenario predicates (billing not enabled, restricted mode, quota exceeded, etc.)
 */

import { describe, expect, test } from "bun:test";
import {
  registerReadinessRules,
  getReadinessRules,
  listReadinessProviders,
  runReadinessChecks,
  enforceReadiness,
  validateAllProviders,
  generateReadinessJson,
  generateAllReadinessJson,
  ProviderNotReadyError,
  type ProviderReadinessRules,
  type ReadinessResult,
} from "../provision-readiness.ts";
import { StackError } from "../errors.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};
const capturedLogs: string[] = [];
function testLog(level: "info" | "warn" | "error", msg: string) {
  capturedLogs.push(`${level}: ${msg}`);
}

function makeRules(
  provider: string,
  overrides: Partial<ProviderReadinessRules> = {},
): ProviderReadinessRules {
  return {
    provider,
    title: `${provider} Test Rules`,
    hard: [],
    soft: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (1) Registry
// ---------------------------------------------------------------------------

describe("readiness registry", () => {
  test("built-in providers are registered on module load", () => {
    const providers = listReadinessProviders();
    expect(providers).toContain("vercel");
    expect(providers).toContain("stripe");
    expect(providers).toContain("supabase");
    expect(providers).toContain("neon");
    expect(providers).toContain("github");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("aws");
  });

  test("getReadinessRules returns rules for a known provider", () => {
    const rules = getReadinessRules("vercel");
    expect(rules).toBeDefined();
    expect(rules!.provider).toBe("vercel");
    expect(Array.isArray(rules!.hard)).toBe(true);
    expect(Array.isArray(rules!.soft)).toBe(true);
  });

  test("getReadinessRules is case-insensitive", () => {
    expect(getReadinessRules("VERCEL")).toBeDefined();
    expect(getReadinessRules("Vercel")).toBeDefined();
  });

  test("getReadinessRules returns undefined for unknown provider", () => {
    expect(getReadinessRules("totally-unknown-xyz-provider")).toBeUndefined();
  });

  test("registerReadinessRules is idempotent — re-register replaces rules", () => {
    const id = "test-registry-idempotency";
    registerReadinessRules(makeRules(id, { title: "First" }));
    expect(getReadinessRules(id)!.title).toBe("First");
    registerReadinessRules(makeRules(id, { title: "Second" }));
    expect(getReadinessRules(id)!.title).toBe("Second");
  });

  test("listReadinessProviders returns sorted list", () => {
    const providers = listReadinessProviders();
    const sorted = [...providers].sort();
    expect(providers).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// (2) runReadinessChecks
// ---------------------------------------------------------------------------

describe("runReadinessChecks", () => {
  test("returns passed=true for provider with no rules", () => {
    const result = runReadinessChecks("no-rules-provider-xyz");
    expect(result.passed).toBe(true);
    expect(result.blockingFailures).toHaveLength(0);
    expect(result.advisories).toHaveLength(0);
    expect(result.hardOutcomes).toHaveLength(0);
    expect(result.softOutcomes).toHaveLength(0);
  });

  test("hard check that passes → passed=true, no blockingFailures", () => {
    const id = "test-hard-pass";
    registerReadinessRules(
      makeRules(id, {
        hard: [
          {
            id: `${id}.always-pass`,
            title: "Always pass",
            description: "Test",
            severity: "hard",
            predicate: () => true,
            remediation: "N/A",
          },
        ],
      }),
    );
    const result = runReadinessChecks(id);
    expect(result.passed).toBe(true);
    expect(result.blockingFailures).toHaveLength(0);
    expect(result.hardOutcomes[0].passed).toBe(true);
  });

  test("hard check that fails → passed=false, blockingFailures populated", () => {
    const id = "test-hard-fail";
    registerReadinessRules(
      makeRules(id, {
        hard: [
          {
            id: `${id}.always-fail`,
            title: "Always fail",
            description: "Test",
            severity: "hard",
            predicate: () => false,
            remediation: "Fix it",
          },
        ],
      }),
    );
    const result = runReadinessChecks(id);
    expect(result.passed).toBe(false);
    expect(result.blockingFailures).toContain(`${id}.always-fail`);
    expect(result.hardOutcomes[0].remediation).toBe("Fix it");
  });

  test("soft check that fails → passed=true (not blocking), advisories populated", () => {
    const id = "test-soft-fail";
    registerReadinessRules(
      makeRules(id, {
        soft: [
          {
            id: `${id}.soft-warn`,
            title: "Soft warning",
            description: "Test",
            severity: "soft",
            predicate: () => false,
            remediation: "Advisory fix",
          },
        ],
      }),
    );
    const result = runReadinessChecks(id);
    expect(result.passed).toBe(true); // soft never blocks
    expect(result.advisories).toContain(`${id}.soft-warn`);
    expect(result.softOutcomes[0].remediation).toBe("Advisory fix");
  });

  test("predicate that throws is treated as failed", () => {
    const id = "test-predicate-throws";
    registerReadinessRules(
      makeRules(id, {
        hard: [
          {
            id: `${id}.throws`,
            title: "Throws",
            description: "Test",
            severity: "hard",
            predicate: () => {
              throw new Error("unexpected");
            },
            remediation: "Handle error",
          },
        ],
      }),
    );
    const result = runReadinessChecks(id);
    expect(result.passed).toBe(false);
    expect(result.blockingFailures).toContain(`${id}.throws`);
  });

  test("function-based remediation receives hints", () => {
    const id = "test-dynamic-remediation";
    registerReadinessRules(
      makeRules(id, {
        hard: [
          {
            id: `${id}.dynamic`,
            title: "Dynamic remediation",
            description: "Test",
            severity: "hard",
            predicate: () => false,
            remediation: (hints) => `Fix for region: ${hints?.region ?? "unknown"}`,
          },
        ],
      }),
    );
    const result = runReadinessChecks(id, { region: "us-east-1" });
    expect(result.hardOutcomes[0].remediation).toBe("Fix for region: us-east-1");
  });

  test("hints are passed to predicate", () => {
    const id = "test-hints-predicate";
    registerReadinessRules(
      makeRules(id, {
        hard: [
          {
            id: `${id}.check-hint`,
            title: "Check hint",
            description: "Test",
            severity: "hard",
            predicate: (hints) => hints?.ready === true,
            remediation: "Pass ready=true in hints",
          },
        ],
      }),
    );
    expect(runReadinessChecks(id, { ready: true }).passed).toBe(true);
    expect(runReadinessChecks(id, { ready: false }).passed).toBe(false);
    expect(runReadinessChecks(id).passed).toBe(false); // no hints
  });

  test("multiple hard checks — all must pass", () => {
    const id = "test-multi-hard";
    registerReadinessRules(
      makeRules(id, {
        hard: [
          {
            id: `${id}.a`,
            title: "Check A",
            description: "Test",
            severity: "hard",
            predicate: () => true,
            remediation: "Fix A",
          },
          {
            id: `${id}.b`,
            title: "Check B",
            description: "Test",
            severity: "hard",
            predicate: () => false,
            remediation: "Fix B",
          },
        ],
      }),
    );
    const result = runReadinessChecks(id);
    expect(result.passed).toBe(false);
    expect(result.blockingFailures).toContain(`${id}.b`);
    expect(result.blockingFailures).not.toContain(`${id}.a`);
  });
});

// ---------------------------------------------------------------------------
// (3) enforceReadiness — pipeline integration
// ---------------------------------------------------------------------------

describe("enforceReadiness", () => {
  test("passes silently when all hard checks pass", () => {
    const id = "test-enforce-pass";
    registerReadinessRules(
      makeRules(id, {
        hard: [
          {
            id: `${id}.ok`,
            title: "OK",
            description: "Test",
            severity: "hard",
            predicate: () => true,
            remediation: "N/A",
          },
        ],
      }),
    );
    const result = enforceReadiness({ provider: id, log: noop });
    expect(result.passed).toBe(true);
  });

  test("throws StackError with PROVIDER_NOT_READY code when hard check fails", () => {
    const id = "test-enforce-throw";
    registerReadinessRules(
      makeRules(id, {
        hard: [
          {
            id: `${id}.block`,
            title: "Blocking failure",
            description: "Test",
            severity: "hard",
            predicate: () => false,
            remediation: "Do the thing",
          },
        ],
      }),
    );
    expect(() => enforceReadiness({ provider: id, log: noop })).toThrow(StackError);
    try {
      enforceReadiness({ provider: id, log: noop });
    } catch (err) {
      expect(err instanceof StackError).toBe(true);
      expect((err as StackError).code).toBe("PROVIDER_NOT_READY");
      expect((err as StackError).message).toMatch(/Blocking failure/);
      expect((err as StackError).message).toMatch(/Do the thing/);
    }
  });

  test("logs warning for soft failures but does not throw", () => {
    const id = "test-enforce-soft";
    const logs: string[] = [];
    registerReadinessRules(
      makeRules(id, {
        soft: [
          {
            id: `${id}.advisory`,
            title: "Advisory warning",
            description: "Test",
            severity: "soft",
            predicate: () => false,
            remediation: "Consider doing X",
          },
        ],
      }),
    );
    const result = enforceReadiness({
      provider: id,
      log: (level, msg) => logs.push(`${level}: ${msg}`),
    });
    expect(result.passed).toBe(true);
    expect(logs.some((l) => l.includes("warn") && l.includes("advisory"))).toBe(true);
    expect(logs.some((l) => l.includes("Consider doing X"))).toBe(true);
  });

  test("passes trivially for provider with no rules", () => {
    const result = enforceReadiness({ provider: "no-rules-xyz-abc", log: noop });
    expect(result.passed).toBe(true);
  });

  test("error message includes remediation text", () => {
    const id = "test-enforce-remediation-in-message";
    registerReadinessRules(
      makeRules(id, {
        hard: [
          {
            id: `${id}.check`,
            title: "Must configure billing",
            description: "Test",
            severity: "hard",
            predicate: () => false,
            remediation: "Go to https://example.com/billing",
          },
        ],
      }),
    );
    try {
      enforceReadiness({ provider: id, log: noop });
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as StackError).message).toMatch(/https:\/\/example\.com\/billing/);
    }
  });
});

// ---------------------------------------------------------------------------
// (4) validateAllProviders — batch mode
// ---------------------------------------------------------------------------

describe("validateAllProviders", () => {
  test("returns allReady=true when all providers pass", () => {
    const a = "batch-test-pass-a";
    const b = "batch-test-pass-b";
    registerReadinessRules(makeRules(a));
    registerReadinessRules(makeRules(b));
    const result = validateAllProviders([a, b]);
    expect(result.allReady).toBe(true);
    expect(result.providers).toHaveLength(2);
    expect(result.providers.every((p) => p.ready)).toBe(true);
  });

  test("returns allReady=false when any provider fails", () => {
    const pass = "batch-test-pass-z";
    const fail = "batch-test-fail-z";
    registerReadinessRules(makeRules(pass));
    registerReadinessRules(
      makeRules(fail, {
        hard: [
          {
            id: `${fail}.block`,
            title: "Block",
            description: "Test",
            severity: "hard",
            predicate: () => false,
            remediation: "Fix it",
          },
        ],
      }),
    );
    const result = validateAllProviders([pass, fail]);
    expect(result.allReady).toBe(false);
    const failSummary = result.providers.find((p) => p.provider === fail);
    expect(failSummary!.ready).toBe(false);
    expect(failSummary!.blockingFailures).toHaveLength(1);
  });

  test("empty provider list → allReady=true", () => {
    const result = validateAllProviders([]);
    expect(result.allReady).toBe(true);
    expect(result.providers).toHaveLength(0);
  });

  test("providers without rules pass trivially in batch", () => {
    const result = validateAllProviders(["totally-unknown-batch-xyz"]);
    expect(result.allReady).toBe(true);
    expect(result.providers[0].ready).toBe(true);
    expect(result.providers[0].blockingFailures).toHaveLength(0);
  });

  test("advisories are surfaced per-provider in batch", () => {
    const id = "batch-advisory-test";
    registerReadinessRules(
      makeRules(id, {
        soft: [
          {
            id: `${id}.advisory`,
            title: "Soft advice",
            description: "Test",
            severity: "soft",
            predicate: () => false,
            remediation: "Do something",
          },
        ],
      }),
    );
    const result = validateAllProviders([id]);
    expect(result.allReady).toBe(true);
    expect(result.providers[0].advisories).toHaveLength(1);
    expect(result.providers[0].advisories[0].ruleId).toBe(`${id}.advisory`);
  });

  test("checkedAt is a valid ISO 8601 timestamp", () => {
    const result = validateAllProviders([]);
    expect(() => new Date(result.checkedAt)).not.toThrow();
    expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
  });
});

// ---------------------------------------------------------------------------
// (5) generateReadinessJson / generateAllReadinessJson
// ---------------------------------------------------------------------------

describe("generateReadinessJson", () => {
  test("returns undefined for unknown provider", () => {
    expect(generateReadinessJson("unknown-xyz-codegen")).toBeUndefined();
  });

  test("returns descriptor for vercel", () => {
    const json = generateReadinessJson("vercel");
    expect(json).toBeDefined();
    expect(json!.provider).toBe("vercel");
    expect(json!.title).toBe("Vercel Readiness Rules");
    expect(Array.isArray(json!.rules)).toBe(true);
    expect(json!.rules.length).toBeGreaterThan(0);
  });

  test("rules have required fields", () => {
    const json = generateReadinessJson("stripe")!;
    for (const rule of json.rules) {
      expect(typeof rule.id).toBe("string");
      expect(typeof rule.title).toBe("string");
      expect(typeof rule.description).toBe("string");
      expect(["hard", "soft"]).toContain(rule.severity);
    }
  });

  test("static remediation is included as remediationTemplate", () => {
    const json = generateReadinessJson("anthropic")!;
    const billingRule = json.rules.find((r) => r.id === "anthropic.billing-configured");
    expect(billingRule).toBeDefined();
    expect(billingRule!.remediationTemplate).toBeDefined();
    expect(billingRule!.remediationTemplate).toMatch(/billing/i);
  });

  test("generatedAt is a valid ISO 8601 string", () => {
    const json = generateReadinessJson("neon")!;
    expect(() => new Date(json.generatedAt)).not.toThrow();
    expect(new Date(json.generatedAt).toISOString()).toBe(json.generatedAt);
  });

  test("generateAllReadinessJson includes all 8 built-in providers", () => {
    const all = generateAllReadinessJson();
    expect(Object.keys(all)).toContain("vercel");
    expect(Object.keys(all)).toContain("stripe");
    expect(Object.keys(all)).toContain("supabase");
    expect(Object.keys(all)).toContain("neon");
    expect(Object.keys(all)).toContain("github");
    expect(Object.keys(all)).toContain("anthropic");
    expect(Object.keys(all)).toContain("openai");
    expect(Object.keys(all)).toContain("aws");
  });
});

// ---------------------------------------------------------------------------
// (6) ProviderNotReadyError
// ---------------------------------------------------------------------------

describe("ProviderNotReadyError", () => {
  test("is an instance of Error", () => {
    const result: ReadinessResult = {
      provider: "test",
      hardOutcomes: [
        { ruleId: "test.fail", ruleTitle: "Test fail", severity: "hard", passed: false, remediation: "Fix" },
      ],
      softOutcomes: [],
      passed: false,
      blockingFailures: ["test.fail"],
      advisories: [],
    };
    const err = new ProviderNotReadyError("test", result);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ProviderNotReadyError).toBe(true);
    expect(err.name).toBe("ProviderNotReadyError");
  });

  test("message includes provider name and rule id", () => {
    const result: ReadinessResult = {
      provider: "vercel",
      hardOutcomes: [
        {
          ruleId: "vercel.billing-enabled",
          ruleTitle: "Billing check",
          severity: "hard",
          passed: false,
          remediation: "Enable billing",
        },
      ],
      softOutcomes: [],
      passed: false,
      blockingFailures: ["vercel.billing-enabled"],
      advisories: [],
    };
    const err = new ProviderNotReadyError("vercel", result);
    expect(err.message).toMatch(/vercel/);
    expect(err.message).toMatch(/vercel\.billing-enabled/);
    expect(err.provider).toBe("vercel");
  });
});

// ---------------------------------------------------------------------------
// (7a) Vercel built-in rules — real API scenarios
// ---------------------------------------------------------------------------

describe("Vercel readiness rules", () => {
  test("billing-enabled: passes when billing confirmed", () => {
    const r = runReadinessChecks("vercel", { vercel_billing_enabled: true });
    expect(r.blockingFailures).not.toContain("vercel.billing-enabled");
  });

  test("billing-enabled: FAILS when billing explicitly not enabled (billing not enabled scenario)", () => {
    const r = runReadinessChecks("vercel", { vercel_billing_enabled: false });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("vercel.billing-enabled");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "vercel.billing-enabled");
    expect(outcome?.remediation).toMatch(/billing/i);
  });

  test("billing-enabled: passes when hint is absent (unknown state)", () => {
    const r = runReadinessChecks("vercel");
    expect(r.blockingFailures).not.toContain("vercel.billing-enabled");
  });

  test("team-exists: passes when no team_id supplied (personal account)", () => {
    const r = runReadinessChecks("vercel", { vercel_billing_enabled: true });
    expect(r.blockingFailures).not.toContain("vercel.team-exists");
  });

  test("team-exists: passes when team_id is non-empty", () => {
    const r = runReadinessChecks("vercel", { vercel_team_id: "team_abc123" });
    expect(r.blockingFailures).not.toContain("vercel.team-exists");
  });

  test("team-exists: FAILS when team_id is empty string", () => {
    const r = runReadinessChecks("vercel", { vercel_team_id: "" });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("vercel.team-exists");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "vercel.team-exists");
    expect(outcome?.remediation).toMatch(/team/i);
  });

  test("region-quota-warning: fires advisory when project count >= 40", () => {
    const r = runReadinessChecks("vercel", { vercel_existing_project_count: 45 });
    expect(r.passed).toBe(true); // soft — not blocking
    expect(r.advisories).toContain("vercel.region-quota-warning");
  });

  test("region-quota-warning: no advisory when project count < 40", () => {
    const r = runReadinessChecks("vercel", { vercel_existing_project_count: 10 });
    expect(r.advisories).not.toContain("vercel.region-quota-warning");
  });
});

// ---------------------------------------------------------------------------
// (7b) Stripe built-in rules — real API scenarios
// ---------------------------------------------------------------------------

describe("Stripe readiness rules", () => {
  test("account-not-restricted: FAILS when account is in restricted mode", () => {
    const r = runReadinessChecks("stripe", { stripe_account_restricted: true });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("stripe.account-not-restricted");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "stripe.account-not-restricted");
    expect(outcome?.remediation).toMatch(/restricted/i);
  });

  test("account-not-restricted: passes when account is confirmed not restricted", () => {
    const r = runReadinessChecks("stripe", { stripe_account_restricted: false });
    expect(r.blockingFailures).not.toContain("stripe.account-not-restricted");
  });

  test("account-not-restricted: passes when restriction state unknown", () => {
    const r = runReadinessChecks("stripe");
    expect(r.blockingFailures).not.toContain("stripe.account-not-restricted");
  });

  test("api-version-compatible: passes for version 2020-08-27", () => {
    const r = runReadinessChecks("stripe", { stripe_api_version: "2020-08-27" });
    expect(r.blockingFailures).not.toContain("stripe.api-version-compatible");
  });

  test("api-version-compatible: passes for version newer than minimum", () => {
    const r = runReadinessChecks("stripe", { stripe_api_version: "2023-10-16" });
    expect(r.blockingFailures).not.toContain("stripe.api-version-compatible");
  });

  test("api-version-compatible: FAILS for old API version (e.g. 2019-05-16)", () => {
    const r = runReadinessChecks("stripe", { stripe_api_version: "2019-05-16" });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("stripe.api-version-compatible");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "stripe.api-version-compatible");
    expect(outcome?.remediation).toMatch(/2019-05-16/);
    expect(outcome?.remediation).toMatch(/2020-08-27/);
  });

  test("test-mode-recommended: advisory when live key used in dev env", () => {
    const r = runReadinessChecks("stripe", {
      environment: "development",
      stripe_key_mode: "live",
    });
    expect(r.passed).toBe(true);
    expect(r.advisories).toContain("stripe.test-mode-recommended");
  });

  test("test-mode-recommended: no advisory for production environment", () => {
    const r = runReadinessChecks("stripe", {
      environment: "production",
      stripe_key_mode: "live",
    });
    expect(r.advisories).not.toContain("stripe.test-mode-recommended");
  });
});

// ---------------------------------------------------------------------------
// (7c) Supabase built-in rules — quota exceeded scenario
// ---------------------------------------------------------------------------

describe("Supabase readiness rules", () => {
  test("org-exists: passes when valid org_id is provided", () => {
    const r = runReadinessChecks("supabase", { supabase_org_id: "org_abc123" });
    expect(r.blockingFailures).not.toContain("supabase.org-exists");
  });

  test("org-exists: FAILS when org_id is empty string (org does not exist scenario)", () => {
    const r = runReadinessChecks("supabase", { supabase_org_id: "" });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("supabase.org-exists");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "supabase.org-exists");
    expect(outcome?.remediation).toMatch(/organization/i);
  });

  test("org-exists: passes when org_id hint is absent", () => {
    const r = runReadinessChecks("supabase");
    expect(r.blockingFailures).not.toContain("supabase.org-exists");
  });

  test("quota-not-exceeded: FAILS when free tier has 2+ projects (quota exceeded scenario)", () => {
    const r = runReadinessChecks("supabase", {
      supabase_org_id: "org_abc",
      supabase_project_count: 2,
      supabase_plan: "free",
    });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("supabase.quota-not-exceeded");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "supabase.quota-not-exceeded");
    expect(outcome?.remediation).toMatch(/free-tier/i);
    expect(outcome?.remediation).toMatch(/2/);
  });

  test("quota-not-exceeded: passes when free tier has 1 project", () => {
    const r = runReadinessChecks("supabase", {
      supabase_project_count: 1,
      supabase_plan: "free",
    });
    expect(r.blockingFailures).not.toContain("supabase.quota-not-exceeded");
  });

  test("quota-not-exceeded: passes for Pro plan regardless of project count", () => {
    const r = runReadinessChecks("supabase", {
      supabase_project_count: 10,
      supabase_plan: "pro",
    });
    expect(r.blockingFailures).not.toContain("supabase.quota-not-exceeded");
  });

  test("quota-not-exceeded: passes when count/plan absent (unknown)", () => {
    const r = runReadinessChecks("supabase");
    expect(r.blockingFailures).not.toContain("supabase.quota-not-exceeded");
  });

  test("region-availability: advisory when region is in unavailable list", () => {
    const r = runReadinessChecks("supabase", {
      region: "us-east-1",
      supabase_unavailable_regions: ["us-east-1", "ap-southeast-1"],
    });
    expect(r.passed).toBe(true);
    expect(r.advisories).toContain("supabase.region-availability");
    const outcome = r.softOutcomes.find((o) => o.ruleId === "supabase.region-availability");
    expect(outcome?.remediation).toMatch(/us-east-1/);
  });

  test("region-availability: no advisory when region is available", () => {
    const r = runReadinessChecks("supabase", {
      region: "eu-west-1",
      supabase_unavailable_regions: ["us-east-1"],
    });
    expect(r.advisories).not.toContain("supabase.region-availability");
  });
});

// ---------------------------------------------------------------------------
// (7d) Neon built-in rules
// ---------------------------------------------------------------------------

describe("Neon readiness rules", () => {
  test("project-quota-not-exceeded: FAILS on free tier with existing project", () => {
    const r = runReadinessChecks("neon", {
      neon_free_tier: true,
      neon_existing_project_count: 1,
    });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("neon.project-quota-not-exceeded");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "neon.project-quota-not-exceeded");
    expect(outcome?.remediation).toMatch(/free-tier/i);
  });

  test("project-quota-not-exceeded: passes on free tier with no projects", () => {
    const r = runReadinessChecks("neon", {
      neon_free_tier: true,
      neon_existing_project_count: 0,
    });
    expect(r.blockingFailures).not.toContain("neon.project-quota-not-exceeded");
  });

  test("project-quota-not-exceeded: passes on paid plan regardless of count", () => {
    const r = runReadinessChecks("neon", {
      neon_free_tier: false,
      neon_existing_project_count: 5,
    });
    expect(r.blockingFailures).not.toContain("neon.project-quota-not-exceeded");
  });

  test("region-valid: FAILS for non-Neon region string", () => {
    const r = runReadinessChecks("neon", { region: "us-east-1" }); // missing aws- prefix
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("neon.region-valid");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "neon.region-valid");
    expect(outcome?.remediation).toMatch(/us-east-1/);
  });

  test("region-valid: passes for valid Neon region", () => {
    const r = runReadinessChecks("neon", { region: "aws-us-east-2" });
    expect(r.blockingFailures).not.toContain("neon.region-valid");
  });

  test("region-valid: passes when no region hint", () => {
    const r = runReadinessChecks("neon");
    expect(r.blockingFailures).not.toContain("neon.region-valid");
  });

  test("pg-version-recommended: advisory for pg 14", () => {
    const r = runReadinessChecks("neon", { neon_pg_version: 14 });
    expect(r.passed).toBe(true);
    expect(r.advisories).toContain("neon.pg-version-recommended");
  });

  test("pg-version-recommended: no advisory for pg 17", () => {
    const r = runReadinessChecks("neon", { neon_pg_version: 17 });
    expect(r.advisories).not.toContain("neon.pg-version-recommended");
  });
});

// ---------------------------------------------------------------------------
// (7e) GitHub built-in rules
// ---------------------------------------------------------------------------

describe("GitHub readiness rules", () => {
  test("org-membership-confirmed: passes when no org (personal repo)", () => {
    const r = runReadinessChecks("github");
    expect(r.blockingFailures).not.toContain("github.org-membership-confirmed");
  });

  test("org-membership-confirmed: FAILS when org set but membership denied", () => {
    const r = runReadinessChecks("github", {
      github_org: "acme-corp",
      github_org_member: false,
    });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("github.org-membership-confirmed");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "github.org-membership-confirmed");
    expect(outcome?.remediation).toMatch(/acme-corp/);
  });

  test("org-membership-confirmed: passes when org set and membership confirmed", () => {
    const r = runReadinessChecks("github", {
      github_org: "acme-corp",
      github_org_member: true,
    });
    expect(r.blockingFailures).not.toContain("github.org-membership-confirmed");
  });

  test("api-rate-limit-ok: FAILS when remaining requests <= 100", () => {
    const r = runReadinessChecks("github", {
      github_rate_limit_remaining: 50,
      github_rate_limit_reset: "2026-06-29T12:00:00Z",
    });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("github.api-rate-limit-ok");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "github.api-rate-limit-ok");
    expect(outcome?.remediation).toMatch(/50/);
  });

  test("api-rate-limit-ok: passes when remaining > 100", () => {
    const r = runReadinessChecks("github", { github_rate_limit_remaining: 4500 });
    expect(r.blockingFailures).not.toContain("github.api-rate-limit-ok");
  });

  test("api-rate-limit-ok: passes when hint absent", () => {
    const r = runReadinessChecks("github");
    expect(r.blockingFailures).not.toContain("github.api-rate-limit-ok");
  });

  test("2fa-recommended: advisory when 2fa disabled", () => {
    const r = runReadinessChecks("github", { github_2fa_enabled: false });
    expect(r.passed).toBe(true);
    expect(r.advisories).toContain("github.2fa-recommended");
  });

  test("2fa-recommended: no advisory when 2fa enabled", () => {
    const r = runReadinessChecks("github", { github_2fa_enabled: true });
    expect(r.advisories).not.toContain("github.2fa-recommended");
  });
});

// ---------------------------------------------------------------------------
// (7f) Anthropic built-in rules
// ---------------------------------------------------------------------------

describe("Anthropic readiness rules", () => {
  test("billing-configured: FAILS when billing not confirmed", () => {
    const r = runReadinessChecks("anthropic", { anthropic_billing_confirmed: false });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("anthropic.billing-configured");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "anthropic.billing-configured");
    expect(outcome?.remediation).toMatch(/billing/i);
  });

  test("billing-configured: passes when billing confirmed", () => {
    const r = runReadinessChecks("anthropic", { anthropic_billing_confirmed: true });
    expect(r.blockingFailures).not.toContain("anthropic.billing-configured");
  });

  test("billing-configured: passes when hint absent (unknown)", () => {
    const r = runReadinessChecks("anthropic");
    expect(r.blockingFailures).not.toContain("anthropic.billing-configured");
  });

  test("api-key-format: FAILS for wrong prefix", () => {
    const r = runReadinessChecks("anthropic", { anthropic_api_key: "sk-wrong-prefix-key" });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("anthropic.api-key-format");
  });

  test("api-key-format: passes for sk-ant- prefix", () => {
    const r = runReadinessChecks("anthropic", { anthropic_api_key: "sk-ant-api03-abc123" });
    expect(r.blockingFailures).not.toContain("anthropic.api-key-format");
  });

  test("api-key-format: passes when key absent", () => {
    const r = runReadinessChecks("anthropic");
    expect(r.blockingFailures).not.toContain("anthropic.api-key-format");
  });

  test("usage-tier-warning: advisory for Tier 1", () => {
    const r = runReadinessChecks("anthropic", { anthropic_usage_tier: 1 });
    expect(r.passed).toBe(true);
    expect(r.advisories).toContain("anthropic.usage-tier-warning");
  });

  test("usage-tier-warning: no advisory for Tier 2+", () => {
    const r = runReadinessChecks("anthropic", { anthropic_usage_tier: 2 });
    expect(r.advisories).not.toContain("anthropic.usage-tier-warning");
  });
});

// ---------------------------------------------------------------------------
// (7g) OpenAI built-in rules
// ---------------------------------------------------------------------------

describe("OpenAI readiness rules", () => {
  test("api-key-format: FAILS for non-sk- prefix", () => {
    const r = runReadinessChecks("openai", { openai_api_key: "org-wrongprefix" });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("openai.api-key-format");
  });

  test("api-key-format: passes for sk- prefix", () => {
    const r = runReadinessChecks("openai", { openai_api_key: "sk-abc123" });
    expect(r.blockingFailures).not.toContain("openai.api-key-format");
  });

  test("api-key-format: passes when no key hint", () => {
    const r = runReadinessChecks("openai");
    expect(r.blockingFailures).not.toContain("openai.api-key-format");
  });

  test("billing-active: FAILS when explicitly inactive", () => {
    const r = runReadinessChecks("openai", { openai_billing_active: false });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("openai.billing-active");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "openai.billing-active");
    expect(outcome?.remediation).toMatch(/payment/i);
  });

  test("billing-active: passes when active or unknown", () => {
    expect(runReadinessChecks("openai", { openai_billing_active: true }).blockingFailures).not.toContain("openai.billing-active");
    expect(runReadinessChecks("openai").blockingFailures).not.toContain("openai.billing-active");
  });

  test("rate-limit-tier: advisory when tier 1", () => {
    const r = runReadinessChecks("openai", { openai_tier: 1 });
    expect(r.passed).toBe(true);
    expect(r.advisories).toContain("openai.rate-limit-tier");
  });

  test("rate-limit-tier: no advisory when tier >= 2", () => {
    const r = runReadinessChecks("openai", { openai_tier: 3 });
    expect(r.advisories).not.toContain("openai.rate-limit-tier");
  });
});

// ---------------------------------------------------------------------------
// (7h) AWS built-in rules
// ---------------------------------------------------------------------------

describe("AWS readiness rules", () => {
  test("region-quota-available: FAILS when explicitly not available", () => {
    const r = runReadinessChecks("aws", { aws_service_quota_ok: false });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("aws.region-quota-available");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "aws.region-quota-available");
    expect(outcome?.remediation).toMatch(/quota/i);
  });

  test("region-quota-available: passes when confirmed or unknown", () => {
    expect(runReadinessChecks("aws", { aws_service_quota_ok: true }).blockingFailures).not.toContain("aws.region-quota-available");
    expect(runReadinessChecks("aws").blockingFailures).not.toContain("aws.region-quota-available");
  });

  test("credentials-valid: FAILS when credentials invalid", () => {
    const r = runReadinessChecks("aws", { aws_credentials_valid: false });
    expect(r.passed).toBe(false);
    expect(r.blockingFailures).toContain("aws.credentials-valid");
    const outcome = r.hardOutcomes.find((o) => o.ruleId === "aws.credentials-valid");
    expect(outcome?.remediation).toMatch(/credentials/i);
  });

  test("credentials-valid: passes when valid or unknown", () => {
    expect(runReadinessChecks("aws", { aws_credentials_valid: true }).blockingFailures).not.toContain("aws.credentials-valid");
    expect(runReadinessChecks("aws").blockingFailures).not.toContain("aws.credentials-valid");
  });

  test("root-credentials-warning: advisory when root credentials detected", () => {
    const r = runReadinessChecks("aws", { aws_is_root_credentials: true });
    expect(r.passed).toBe(true);
    expect(r.advisories).toContain("aws.root-credentials-warning");
    const outcome = r.softOutcomes.find((o) => o.ruleId === "aws.root-credentials-warning");
    expect(outcome?.remediation).toMatch(/root/i);
  });

  test("root-credentials-warning: no advisory for IAM credentials", () => {
    const r = runReadinessChecks("aws", { aws_is_root_credentials: false });
    expect(r.advisories).not.toContain("aws.root-credentials-warning");
  });
});

// ---------------------------------------------------------------------------
// Pipeline integration — enforceReadiness is called from pipeline.ts
// ---------------------------------------------------------------------------

describe("pipeline integration (enforceReadiness in context)", () => {
  test("enforceReadiness integrates: throws StackError with PROVIDER_NOT_READY for known provider", () => {
    // vercel with billing disabled should trigger PROVIDER_NOT_READY
    expect(() =>
      enforceReadiness({
        provider: "vercel",
        hints: { vercel_billing_enabled: false },
        log: noop,
      }),
    ).toThrow(StackError);

    try {
      enforceReadiness({
        provider: "vercel",
        hints: { vercel_billing_enabled: false },
        log: noop,
      });
    } catch (err) {
      expect(err instanceof StackError).toBe(true);
      expect((err as StackError).code).toBe("PROVIDER_NOT_READY");
    }
  });

  test("enforceReadiness passes for provider with no rules (transparent)", () => {
    const result = enforceReadiness({ provider: "unknown-transparent-xyz", log: noop });
    expect(result.passed).toBe(true);
  });

  test("enforceReadiness logs error before throwing", () => {
    const logs: string[] = [];
    try {
      enforceReadiness({
        provider: "stripe",
        hints: { stripe_account_restricted: true },
        log: (level, msg) => logs.push(`${level}: ${msg}`),
      });
    } catch {
      // expected
    }
    expect(logs.some((l) => l.startsWith("error:"))).toBe(true);
    expect(logs.some((l) => l.includes("[readiness]"))).toBe(true);
  });

  test("validateAllProviders covers multiple providers end-to-end", () => {
    // vercel billing ok, stripe restricted → one pass, one fail
    const result = validateAllProviders(["vercel", "stripe"], {
      vercel_billing_enabled: true,
      stripe_account_restricted: true,
    });
    expect(result.allReady).toBe(false);

    const vercelSummary = result.providers.find((p) => p.provider === "vercel");
    const stripeSummary = result.providers.find((p) => p.provider === "stripe");
    expect(vercelSummary!.ready).toBe(true);
    expect(stripeSummary!.ready).toBe(false);
    expect(stripeSummary!.blockingFailures[0].ruleId).toBe("stripe.account-not-restricted");
  });
});
