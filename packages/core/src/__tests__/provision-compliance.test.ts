import { describe, expect, test, beforeEach } from "bun:test";
import {
  registerComplianceRules,
  getComplianceRules,
  listComplianceProviders,
  runPreChecks,
  runPostChecks,
  enforcePreCompliance,
  enforcePostCompliance,
  assertCompliance,
  ComplianceViolationError,
  generateComplianceRulesJson,
  generateAllComplianceRulesJson,
  type ProviderComplianceRules,
  type ComplianceResult,
} from "../provision-compliance.ts";
import { StackError } from "../errors.ts";
import type { Resource } from "../providers/_base.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: "test-id-123",
    displayName: "Test Resource",
    ...overrides,
  };
}

const noop = () => {};
const logs: string[] = [];
function testLog(level: "info" | "warn" | "error", msg: string) {
  logs.push(`${level}: ${msg}`);
}

// ---------------------------------------------------------------------------
// Core registry
// ---------------------------------------------------------------------------

describe("compliance registry", () => {
  test("registered rules are retrievable", () => {
    const rules = getComplianceRules("neon");
    expect(rules).toBeDefined();
    expect(rules!.provider).toBe("neon");
  });

  test("listComplianceProviders includes built-in providers", () => {
    const providers = listComplianceProviders();
    expect(providers).toContain("neon");
    expect(providers).toContain("stripe");
    expect(providers).toContain("anthropic");
    expect(providers).toContain("aws");
  });

  test("getComplianceRules returns undefined for unknown provider", () => {
    expect(getComplianceRules("nonexistent-provider-xyz")).toBeUndefined();
  });

  test("registerComplianceRules is idempotent — re-register replaces rules", () => {
    const customRules: ProviderComplianceRules = {
      provider: "custom-test-provider",
      title: "Custom Test",
      preChecks: [],
      postChecks: [
        {
          id: "custom.always-pass",
          title: "Always passes",
          description: "Test check",
          predicate: () => true,
          remediation: "N/A",
        },
      ],
      blockers: [],
      warnings: [],
    };
    registerComplianceRules(customRules);
    expect(getComplianceRules("custom-test-provider")).toBeDefined();

    // Re-register with different title — should replace
    registerComplianceRules({ ...customRules, title: "Updated Title" });
    expect(getComplianceRules("custom-test-provider")!.title).toBe("Updated Title");
  });
});

// ---------------------------------------------------------------------------
// Neon compliance checks
// ---------------------------------------------------------------------------

describe("Neon compliance", () => {
  test("runPostChecks passes when no region hint is supplied", () => {
    const resource = makeResource({ id: "proj-abc", region: "aws-us-east-2" });
    const result = runPostChecks("neon", resource);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  test("runPostChecks passes when region matches hint", () => {
    const resource = makeResource({ id: "proj-abc", region: "aws-us-east-2" });
    const result = runPostChecks("neon", resource, { region: "aws-us-east-2" });
    expect(result.passed).toBe(true);
  });

  test("runPostChecks FAILS when region does not match hint", () => {
    const resource = makeResource({ id: "proj-abc", region: "aws-eu-west-1" });
    const result = runPostChecks("neon", resource, { region: "aws-us-east-2" });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("neon.region-match");
    const outcome = result.postCheckOutcomes.find((o) => o.checkId === "neon.region-match");
    expect(outcome?.remediation).toMatch(/aws-eu-west-1/);
    expect(outcome?.remediation).toMatch(/aws-us-east-2/);
  });

  test("runPostChecks FAILS when project id is empty", () => {
    const resource = makeResource({ id: "" });
    const result = runPostChecks("neon", resource);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("neon.project-id-format");
  });

  test("neon.free-tier-project-limit blocker passes when count is 0 and free tier", () => {
    const resource = makeResource({ id: "proj-new" });
    const result = runPostChecks("neon", resource, {
      neon_existing_project_count: 0,
      neon_free_tier: true,
    });
    expect(result.passed).toBe(true);
  });

  test("neon.free-tier-project-limit blocker FAILS when already has 1 project on free tier", () => {
    const resource = makeResource({ id: "proj-new" });
    const result = runPostChecks("neon", resource, {
      neon_existing_project_count: 1,
      neon_free_tier: true,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("neon.free-tier-project-limit");
  });

  test("neon.free-tier-project-limit passes when not on free tier regardless of count", () => {
    const resource = makeResource({ id: "proj-new" });
    const result = runPostChecks("neon", resource, {
      neon_existing_project_count: 5,
      neon_free_tier: false,
    });
    // blocker only fires on free tier
    expect(result.failures).not.toContain("neon.free-tier-project-limit");
  });

  test("neon.pg-version-recommended warning fires for pg14", () => {
    const resource = makeResource({ id: "proj-abc", meta: { pg_version: 14 } });
    const result = runPostChecks("neon", resource);
    expect(result.advisories).toContain("neon.pg-version-recommended");
  });

  test("neon.pg-version-recommended warning does NOT fire for pg17", () => {
    const resource = makeResource({ id: "proj-abc", meta: { pg_version: 17 } });
    const result = runPostChecks("neon", resource);
    expect(result.advisories).not.toContain("neon.pg-version-recommended");
  });
});

// ---------------------------------------------------------------------------
// Stripe compliance checks
// ---------------------------------------------------------------------------

describe("Stripe compliance", () => {
  test("passes when no stripe_key_mode hint is supplied", () => {
    const resource = makeResource({ id: "acct_test123", meta: { key_mode: "live" } });
    const result = runPostChecks("stripe", resource);
    expect(result.failures).not.toContain("stripe.live-key-detection");
  });

  test("passes when key mode matches expected 'test'", () => {
    const resource = makeResource({ id: "acct_test123", meta: { key_mode: "test" } });
    const result = runPostChecks("stripe", resource, { stripe_key_mode: "test" });
    expect(result.passed).toBe(true);
  });

  test("FAILS when key mode is 'live' but 'test' expected", () => {
    const resource = makeResource({ id: "acct_live123", meta: { key_mode: "live" } });
    const result = runPostChecks("stripe", resource, { stripe_key_mode: "test" });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("stripe.live-key-detection");
    const outcome = result.postCheckOutcomes.find((o) => o.checkId === "stripe.live-key-detection");
    expect(outcome?.remediation).toMatch(/live/);
  });

  test("stripe.account-id-format FAILS when id is empty", () => {
    const resource = makeResource({ id: "" });
    const result = runPostChecks("stripe", resource);
    expect(result.failures).toContain("stripe.account-id-format");
  });

  test("stripe.charges-enabled blocker passes when hint not set", () => {
    const resource = makeResource({ id: "acct_abc", meta: { charges_enabled: false } });
    // Not requiring charges — blocker should not fire
    const result = runPostChecks("stripe", resource);
    expect(result.failures).not.toContain("stripe.charges-enabled");
  });

  test("stripe.charges-enabled blocker FAILS when required but disabled", () => {
    const resource = makeResource({ id: "acct_abc", meta: { charges_enabled: false } });
    const result = runPostChecks("stripe", resource, {
      stripe_require_charges_enabled: true,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("stripe.charges-enabled");
  });

  test("stripe.charges-enabled blocker passes when charges are enabled", () => {
    const resource = makeResource({ id: "acct_abc", meta: { charges_enabled: true } });
    const result = runPostChecks("stripe", resource, {
      stripe_require_charges_enabled: true,
    });
    expect(result.failures).not.toContain("stripe.charges-enabled");
  });

  test("stripe.test-mode-recommended-for-dev warning fires for live key in dev", () => {
    const resource = makeResource({ id: "acct_abc", meta: { key_mode: "live" } });
    const result = runPostChecks("stripe", resource, { environment: "development" });
    expect(result.advisories).toContain("stripe.test-mode-recommended-for-dev");
  });

  test("stripe.test-mode-recommended-for-dev warning does not fire for production", () => {
    const resource = makeResource({ id: "acct_abc", meta: { key_mode: "live" } });
    const result = runPostChecks("stripe", resource, { environment: "production" });
    expect(result.advisories).not.toContain("stripe.test-mode-recommended-for-dev");
  });
});

// ---------------------------------------------------------------------------
// Anthropic compliance checks
// ---------------------------------------------------------------------------

describe("Anthropic compliance", () => {
  test("anthropic.billing-configured pre-check passes when confirmed=true", () => {
    const result = runPreChecks("anthropic", { anthropic_billing_confirmed: true });
    expect(result.passed).toBe(true);
  });

  test("anthropic.billing-configured pre-check FAILS when confirmed=false", () => {
    const result = runPreChecks("anthropic", { anthropic_billing_confirmed: false });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("anthropic.billing-configured");
    const outcome = result.preCheckOutcomes.find((o) => o.checkId === "anthropic.billing-configured");
    expect(outcome?.remediation).toMatch(/billing/i);
  });

  test("anthropic.billing-configured pre-check passes when hint is absent (unknown)", () => {
    const result = runPreChecks("anthropic");
    expect(result.passed).toBe(true);
  });

  test("anthropic.api-key-format post-check passes for sk-ant- prefix", () => {
    const resource = makeResource({ id: "anthropic-default" });
    const result = runPostChecks("anthropic", resource, {
      anthropic_api_key: "sk-ant-api03-abc123",
    });
    expect(result.failures).not.toContain("anthropic.api-key-format");
  });

  test("anthropic.api-key-format post-check FAILS for wrong prefix", () => {
    const resource = makeResource({ id: "anthropic-default" });
    const result = runPostChecks("anthropic", resource, {
      anthropic_api_key: "sk-wrong-key",
    });
    expect(result.failures).toContain("anthropic.api-key-format");
  });

  test("anthropic.api-key-format passes when no key in hints", () => {
    const resource = makeResource({ id: "anthropic-default" });
    const result = runPostChecks("anthropic", resource);
    expect(result.failures).not.toContain("anthropic.api-key-format");
  });

  test("anthropic.resource-id-present FAILS for empty id", () => {
    const resource = makeResource({ id: "" });
    const result = runPostChecks("anthropic", resource);
    expect(result.failures).toContain("anthropic.resource-id-present");
  });

  test("anthropic.models-available warning fires when models=0", () => {
    const resource = makeResource({ id: "anthropic-default", meta: { models: "0" } });
    const result = runPostChecks("anthropic", resource);
    expect(result.advisories).toContain("anthropic.models-available");
  });

  test("anthropic.models-available warning does not fire when models=5", () => {
    const resource = makeResource({ id: "anthropic-default", meta: { models: "5" } });
    const result = runPostChecks("anthropic", resource);
    expect(result.advisories).not.toContain("anthropic.models-available");
  });
});

// ---------------------------------------------------------------------------
// AWS compliance checks
// ---------------------------------------------------------------------------

describe("AWS compliance", () => {
  test("aws.account-id-format passes for valid 12-digit account id in meta", () => {
    const resource = makeResource({
      id: "AKIAIOSFODNN7EXAMPLE",
      meta: { account_id: "123456789012", arn: "arn:aws:iam::123456789012:user/dev" },
    });
    const result = runPostChecks("aws", resource);
    expect(result.failures).not.toContain("aws.account-id-format");
  });

  test("aws.account-id-format FAILS for non-12-digit account id", () => {
    const resource = makeResource({
      id: "AKIAIOSFODNN7EXAMPLE",
      meta: { account_id: "12345", arn: "arn:aws:iam::12345:user/dev" },
    });
    const result = runPostChecks("aws", resource);
    expect(result.failures).toContain("aws.account-id-format");
    const outcome = result.postCheckOutcomes.find((o) => o.checkId === "aws.account-id-format");
    expect(outcome?.remediation).toMatch(/12345/);
  });

  test("aws.account-id-format FAILS when resource.id is not 12 digits and no meta.account_id", () => {
    const resource = makeResource({ id: "not-an-aws-account-id" });
    const result = runPostChecks("aws", resource);
    expect(result.failures).toContain("aws.account-id-format");
  });

  test("aws.account-id-format passes when resource.id IS a 12-digit string", () => {
    const resource = makeResource({ id: "123456789012" });
    const result = runPostChecks("aws", resource);
    expect(result.failures).not.toContain("aws.account-id-format");
  });

  test("aws.arn-format passes for standard arn", () => {
    const resource = makeResource({
      id: "123456789012",
      meta: { arn: "arn:aws:iam::123456789012:user/dev" },
    });
    const result = runPostChecks("aws", resource);
    expect(result.failures).not.toContain("aws.arn-format");
  });

  test("aws.arn-format FAILS for malformed arn", () => {
    const resource = makeResource({
      id: "123456789012",
      meta: { arn: "bad-arn-value" },
    });
    const result = runPostChecks("aws", resource);
    expect(result.failures).toContain("aws.arn-format");
  });

  test("aws.arn-format passes when arn is absent", () => {
    const resource = makeResource({ id: "123456789012" });
    const result = runPostChecks("aws", resource);
    expect(result.failures).not.toContain("aws.arn-format");
  });

  test("aws.root-account-warning warning fires for root ARN", () => {
    const resource = makeResource({
      id: "123456789012",
      meta: { arn: "arn:aws:iam::123456789012:root" },
    });
    const result = runPostChecks("aws", resource);
    expect(result.advisories).toContain("aws.root-account-warning");
  });

  test("aws.root-account-warning does not fire for IAM user ARN", () => {
    const resource = makeResource({
      id: "123456789012",
      meta: { arn: "arn:aws:iam::123456789012:user/developer" },
    });
    const result = runPostChecks("aws", resource);
    expect(result.advisories).not.toContain("aws.root-account-warning");
  });
});

// ---------------------------------------------------------------------------
// enforcePostCompliance — pipeline integration helper
// ---------------------------------------------------------------------------

describe("enforcePostCompliance", () => {
  test("resolves when all checks pass", async () => {
    const resource = makeResource({ id: "proj-abc", region: "aws-us-east-2" });
    const result = await enforcePostCompliance({
      provider: "neon",
      resource,
      hints: { region: "aws-us-east-2" },
      log: noop,
    });
    expect(result.passed).toBe(true);
  });

  test("throws StackError with PROVISION_COMPLIANCE_FAILURE code on failure", async () => {
    const resource = makeResource({ id: "" }); // empty id triggers neon.project-id-format
    await expect(
      enforcePostCompliance({ provider: "neon", resource, log: noop }),
    ).rejects.toThrow(StackError);

    try {
      await enforcePostCompliance({ provider: "neon", resource, log: noop });
    } catch (err) {
      expect(err instanceof StackError).toBe(true);
      expect((err as StackError).code).toBe("PROVISION_COMPLIANCE_FAILURE");
    }
  });

  test("calls deprovision on failure", async () => {
    let deprovisionCalled = false;
    const resource = makeResource({ id: "" });
    try {
      await enforcePostCompliance({
        provider: "neon",
        resource,
        log: noop,
        deprovision: async () => {
          deprovisionCalled = true;
        },
      });
    } catch {
      // expected
    }
    expect(deprovisionCalled).toBe(true);
  });

  test("still throws even when deprovision itself throws", async () => {
    const resource = makeResource({ id: "" });
    await expect(
      enforcePostCompliance({
        provider: "neon",
        resource,
        log: noop,
        deprovision: async () => {
          throw new Error("deprovision failed");
        },
      }),
    ).rejects.toThrow(StackError);
  });

  test("logs warnings for advisory failures without blocking", async () => {
    const capturedLogs: string[] = [];
    const resource = makeResource({ id: "proj-abc", meta: { pg_version: 14 } });
    const result = await enforcePostCompliance({
      provider: "neon",
      resource,
      log: (level, msg) => capturedLogs.push(`${level}: ${msg}`),
    });
    expect(result.passed).toBe(true); // warnings don't block
    expect(capturedLogs.some((l) => l.includes("warn"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("advisory"))).toBe(true);
  });

  test("returns emptyResult (passed=true) for providers with no compliance rules", async () => {
    const resource = makeResource({ id: "some-id" });
    const result = await enforcePostCompliance({
      provider: "provider-with-no-rules-xyz",
      resource,
      log: noop,
    });
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// enforcePreCompliance
// ---------------------------------------------------------------------------

describe("enforcePreCompliance", () => {
  test("passes when billing hint is absent for anthropic", () => {
    const result = enforcePreCompliance({
      provider: "anthropic",
      log: noop,
    });
    expect(result.passed).toBe(true);
  });

  test("throws StackError with PRE_PROVISION_COMPLIANCE_FAILURE when billing=false", () => {
    expect(() =>
      enforcePreCompliance({
        provider: "anthropic",
        hints: { anthropic_billing_confirmed: false },
        log: noop,
      }),
    ).toThrow(StackError);

    try {
      enforcePreCompliance({
        provider: "anthropic",
        hints: { anthropic_billing_confirmed: false },
        log: noop,
      });
    } catch (err) {
      expect(err instanceof StackError).toBe(true);
      expect((err as StackError).code).toBe("PRE_PROVISION_COMPLIANCE_FAILURE");
    }
  });
});

// ---------------------------------------------------------------------------
// assertCompliance / ComplianceViolationError
// ---------------------------------------------------------------------------

describe("assertCompliance", () => {
  test("does not throw when passed=true", () => {
    const result: ComplianceResult = {
      provider: "neon",
      preCheckOutcomes: [],
      postCheckOutcomes: [],
      warningOutcomes: [],
      passed: true,
      failures: [],
      advisories: [],
    };
    expect(() => assertCompliance(result)).not.toThrow();
  });

  test("throws ComplianceViolationError when passed=false", () => {
    const result: ComplianceResult = {
      provider: "neon",
      preCheckOutcomes: [],
      postCheckOutcomes: [
        {
          checkId: "neon.region-match",
          checkTitle: "Region match",
          passed: false,
          remediation: "Wrong region",
        },
      ],
      warningOutcomes: [],
      passed: false,
      failures: ["neon.region-match"],
      advisories: [],
    };
    expect(() => assertCompliance(result)).toThrow(ComplianceViolationError);
    try {
      assertCompliance(result);
    } catch (err) {
      expect(err instanceof ComplianceViolationError).toBe(true);
      expect((err as ComplianceViolationError).provider).toBe("neon");
      expect((err as ComplianceViolationError).message).toMatch(/neon.region-match/);
    }
  });
});

// ---------------------------------------------------------------------------
// generateComplianceRulesJson — codegen
// ---------------------------------------------------------------------------

describe("generateComplianceRulesJson", () => {
  test("returns undefined for unknown provider", () => {
    expect(generateComplianceRulesJson("unknown-xyz")).toBeUndefined();
  });

  test("returns descriptor for neon with all buckets", () => {
    const descriptor = generateComplianceRulesJson("neon");
    expect(descriptor).toBeDefined();
    expect(descriptor!.provider).toBe("neon");
    expect(descriptor!.title).toBe("Neon Compliance Rules");
    expect(Array.isArray(descriptor!.checks)).toBe(true);
    expect(descriptor!.checks.length).toBeGreaterThan(0);
  });

  test("checks have required fields", () => {
    const descriptor = generateComplianceRulesJson("neon")!;
    for (const check of descriptor.checks) {
      expect(typeof check.id).toBe("string");
      expect(typeof check.title).toBe("string");
      expect(typeof check.description).toBe("string");
      expect(["preCheck", "postCheck", "blocker", "warning"]).toContain(check.bucket);
    }
  });

  test("neon descriptor contains region-match check as postCheck", () => {
    const descriptor = generateComplianceRulesJson("neon")!;
    const regionCheck = descriptor.checks.find((c) => c.id === "neon.region-match");
    expect(regionCheck).toBeDefined();
    expect(regionCheck!.bucket).toBe("postCheck");
  });

  test("neon descriptor contains free-tier-project-limit check as blocker", () => {
    const descriptor = generateComplianceRulesJson("neon")!;
    const blockerCheck = descriptor.checks.find((c) => c.id === "neon.free-tier-project-limit");
    expect(blockerCheck).toBeDefined();
    expect(blockerCheck!.bucket).toBe("blocker");
    expect(blockerCheck!.remediationTemplate).toMatch(/free-tier/i);
  });

  test("anthropic descriptor contains billing pre-check", () => {
    const descriptor = generateComplianceRulesJson("anthropic")!;
    const billingCheck = descriptor.checks.find((c) => c.id === "anthropic.billing-configured");
    expect(billingCheck).toBeDefined();
    expect(billingCheck!.bucket).toBe("preCheck");
  });

  test("generateAllComplianceRulesJson includes all four built-in providers", () => {
    const all = generateAllComplianceRulesJson();
    expect(Object.keys(all)).toContain("neon");
    expect(Object.keys(all)).toContain("stripe");
    expect(Object.keys(all)).toContain("anthropic");
    expect(Object.keys(all)).toContain("aws");
  });

  test("descriptor generatedAt is a valid ISO 8601 string", () => {
    const descriptor = generateComplianceRulesJson("stripe")!;
    expect(() => new Date(descriptor.generatedAt)).not.toThrow();
    expect(new Date(descriptor.generatedAt).toISOString()).toBe(descriptor.generatedAt);
  });
});

// ---------------------------------------------------------------------------
// runPostChecks for provider with no rules returns passed=true
// ---------------------------------------------------------------------------

describe("runPostChecks / runPreChecks with no rules registered", () => {
  test("runPostChecks returns passed=true for unknown provider", () => {
    const result = runPostChecks("totally-unknown-provider", makeResource());
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  test("runPreChecks returns passed=true for unknown provider", () => {
    const result = runPreChecks("totally-unknown-provider");
    expect(result.passed).toBe(true);
  });
});
