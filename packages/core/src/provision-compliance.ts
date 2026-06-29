/**
 * Provision Compliance Framework
 *
 * Adds a declarative semantic-validation layer on top of the structural
 * JSON Schema validation in provision-schema.ts.  After provider.provision()
 * returns a valid Resource the pipeline runs these checks BEFORE materializing
 * secrets, catching silent misconfigurations early.
 *
 * Key concepts
 * ------------
 *   ProviderComplianceRules  — per-provider rule set (pre/post/blockers/warnings)
 *   ComplianceCheck          — a single named check with a predicate + remediation
 *   ComplianceResult         — outcome of running all checks for one provider
 *
 * Entry points
 * ------------
 *   registerComplianceRules(provider, rules)   — register rules for a provider
 *   getComplianceRules(provider)               — retrieve (or undefined)
 *   runPostChecks(provider, resource, hints?)  — run post-provision checks
 *   runPreChecks(provider, hints?)             — run pre-provision requirement checks
 *   generateComplianceRulesJson(provider)      — codegen: emit compliance-rules.json
 */

import type { Resource } from "./providers/_base.ts";
import { StackError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single compliance check.  The predicate receives the provisioned Resource
 * plus any caller-supplied hints (region target, expected tier, etc.) and
 * returns true when the check passes.
 */
export interface ComplianceCheck {
  /** Machine-readable identifier, e.g. "neon.region-match". */
  id: string;
  /** Human label shown in CLI/log output. */
  title: string;
  /** Detailed explanation of what is being checked. */
  description: string;
  /**
   * Predicate: return true when the check passes.
   * Receives the Resource and optional caller hints.
   * Pre-checks receive `resource: undefined` because provision has not run yet.
   */
  predicate(resource: Resource | undefined, hints?: Record<string, unknown>): boolean;
  /**
   * Suggested fix when the check fails.  May be a static string or a function
   * that builds a dynamic message from the failed resource / hints.
   */
  remediation: string | ((resource: Resource | undefined, hints?: Record<string, unknown>) => string);
}

/**
 * A rule set for one provider.  Rules are partitioned into four buckets:
 *
 *   preChecks   — requirements that must hold BEFORE provision() is called
 *                 (e.g. billing configured, org selected).  Failures abort the
 *                 pipeline before any upstream resource is created.
 *   postChecks  — semantic checks run AFTER provision() returns a Resource but
 *                 BEFORE materialize() is called.  Failures trigger auto-cleanup.
 *   blockers    — hard-fail conditions identical to postChecks but segregated
 *                 for documentation clarity (e.g. wrong account type).
 *   warnings    — soft-fail / recommendation checks.  Never block the pipeline;
 *                 surfaced as advisory messages only.
 */
export interface ProviderComplianceRules {
  /** Provider name (lower-case, matches provision-schema registry key). */
  provider: string;
  /** Human label for documentation and codegen output. */
  title: string;
  /** Short description of the overall compliance concern for this provider. */
  description?: string;
  preChecks: ComplianceCheck[];
  postChecks: ComplianceCheck[];
  blockers: ComplianceCheck[];
  warnings: ComplianceCheck[];
}

/** Outcome of a single check. */
export interface CheckOutcome {
  checkId: string;
  checkTitle: string;
  passed: boolean;
  /** Populated when passed === false. */
  remediation?: string;
}

/** Aggregated result of running all compliance checks for one provider. */
export interface ComplianceResult {
  provider: string;
  /** All pre-check outcomes (empty when preChecks not run). */
  preCheckOutcomes: CheckOutcome[];
  /** All post-check + blocker outcomes. */
  postCheckOutcomes: CheckOutcome[];
  /** Warning-only outcomes (never cause failure). */
  warningOutcomes: CheckOutcome[];
  /** True only when ALL preChecks + postChecks + blockers passed. */
  passed: boolean;
  /** Failed blocker + postCheck IDs (hard failures). */
  failures: string[];
  /** Failed warning IDs (advisory only). */
  advisories: string[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _complianceRegistry = new Map<string, ProviderComplianceRules>();

/** Register compliance rules for a provider.  Idempotent — replaces on re-call. */
export function registerComplianceRules(rules: ProviderComplianceRules): void {
  _complianceRegistry.set(rules.provider.toLowerCase(), rules);
}

/** Retrieve registered compliance rules for a provider, or undefined. */
export function getComplianceRules(provider: string): ProviderComplianceRules | undefined {
  return _complianceRegistry.get(provider.toLowerCase());
}

/** List all providers with registered compliance rules (sorted). */
export function listComplianceProviders(): string[] {
  return [..._complianceRegistry.keys()].sort();
}

// ---------------------------------------------------------------------------
// Runner helpers
// ---------------------------------------------------------------------------

function resolveRemediation(
  check: ComplianceCheck,
  resource: Resource | undefined,
  hints?: Record<string, unknown>,
): string {
  if (typeof check.remediation === "function") {
    return check.remediation(resource, hints);
  }
  return check.remediation;
}

function runChecks(
  checks: ComplianceCheck[],
  resource: Resource | undefined,
  hints?: Record<string, unknown>,
): CheckOutcome[] {
  return checks.map((check) => {
    let passed = false;
    try {
      passed = check.predicate(resource, hints);
    } catch {
      passed = false;
    }
    return {
      checkId: check.id,
      checkTitle: check.title,
      passed,
      remediation: passed ? undefined : resolveRemediation(check, resource, hints),
    };
  });
}

// ---------------------------------------------------------------------------
// Public runner API
// ---------------------------------------------------------------------------

/**
 * Run all pre-checks for a provider BEFORE provision() is called.
 * Returns a ComplianceResult; the caller should abort provision when
 * `result.passed === false`.
 *
 * Pre-checks receive `resource: undefined` because no resource exists yet.
 */
export function runPreChecks(
  provider: string,
  hints?: Record<string, unknown>,
): ComplianceResult {
  const rules = getComplianceRules(provider);
  if (!rules) {
    return emptyResult(provider);
  }
  const preCheckOutcomes = runChecks(rules.preChecks, undefined, hints);
  const failures = preCheckOutcomes
    .filter((o) => !o.passed)
    .map((o) => o.checkId);

  return {
    provider,
    preCheckOutcomes,
    postCheckOutcomes: [],
    warningOutcomes: [],
    passed: failures.length === 0,
    failures,
    advisories: [],
  };
}

/**
 * Run all post-provision checks (postChecks + blockers) and warnings for a
 * provider AFTER provision() returns `resource` but BEFORE materialize().
 *
 * Returns a ComplianceResult; the caller should deprovision + surface a
 * friendly error when `result.passed === false`.
 */
export function runPostChecks(
  provider: string,
  resource: Resource,
  hints?: Record<string, unknown>,
): ComplianceResult {
  const rules = getComplianceRules(provider);
  if (!rules) {
    return emptyResult(provider);
  }

  const postCheckOutcomes = runChecks(
    [...rules.postChecks, ...rules.blockers],
    resource,
    hints,
  );
  const warningOutcomes = runChecks(rules.warnings, resource, hints);

  const failures = postCheckOutcomes
    .filter((o) => !o.passed)
    .map((o) => o.checkId);
  const advisories = warningOutcomes
    .filter((o) => !o.passed)
    .map((o) => o.checkId);

  return {
    provider,
    preCheckOutcomes: [],
    postCheckOutcomes,
    warningOutcomes,
    passed: failures.length === 0,
    failures,
    advisories,
  };
}

function emptyResult(provider: string): ComplianceResult {
  return {
    provider,
    preCheckOutcomes: [],
    postCheckOutcomes: [],
    warningOutcomes: [],
    passed: true,
    failures: [],
    advisories: [],
  };
}

// ---------------------------------------------------------------------------
// Error type for compliance failures
// ---------------------------------------------------------------------------

export class ComplianceViolationError extends Error {
  constructor(
    public readonly provider: string,
    public readonly result: ComplianceResult,
  ) {
    const failedChecks = [
      ...result.preCheckOutcomes,
      ...result.postCheckOutcomes,
    ].filter((o) => !o.passed);

    const summary = failedChecks
      .slice(0, 3)
      .map((o) => `[${o.checkId}] ${o.checkTitle}${o.remediation ? ` — ${o.remediation}` : ""}`)
      .join("; ");

    super(`Compliance check failed for "${provider}": ${summary}`);
    this.name = "ComplianceViolationError";
  }
}

/**
 * Assert that a ComplianceResult passed; throw ComplianceViolationError otherwise.
 * Convenience wrapper for callers that want a single throw point.
 */
export function assertCompliance(result: ComplianceResult): void {
  if (!result.passed) {
    throw new ComplianceViolationError(result.provider, result);
  }
}

// ---------------------------------------------------------------------------
// Codegen: emit compliance-rules.json per provider
// ---------------------------------------------------------------------------

export interface ComplianceRulesJson {
  provider: string;
  title: string;
  description?: string;
  generatedAt: string;
  checks: {
    id: string;
    title: string;
    description: string;
    bucket: "preCheck" | "postCheck" | "blocker" | "warning";
    remediationTemplate?: string;
  }[];
}

/**
 * Generate a `compliance-rules.json` descriptor for a provider.
 * This is emitted by the codegen pipeline so downstream tooling (dashboards,
 * docs sites, security scanners) can inspect the checks without running them.
 *
 * Note: predicates are NOT serialized (they are functions); only metadata is
 * emitted.  Remediation messages that are static strings are included as
 * `remediationTemplate`; function-based remediations are omitted.
 */
export function generateComplianceRulesJson(provider: string): ComplianceRulesJson | undefined {
  const rules = getComplianceRules(provider);
  if (!rules) return undefined;

  const mapBucket = (
    checks: ComplianceCheck[],
    bucket: ComplianceRulesJson["checks"][number]["bucket"],
  ) =>
    checks.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      bucket,
      ...(typeof c.remediation === "string"
        ? { remediationTemplate: c.remediation }
        : {}),
    }));

  return {
    provider: rules.provider,
    title: rules.title,
    description: rules.description,
    generatedAt: new Date().toISOString(),
    checks: [
      ...mapBucket(rules.preChecks, "preCheck"),
      ...mapBucket(rules.postChecks, "postCheck"),
      ...mapBucket(rules.blockers, "blocker"),
      ...mapBucket(rules.warnings, "warning"),
    ],
  };
}

/**
 * Generate compliance-rules.json descriptors for ALL registered providers.
 * Returns a map of provider name → descriptor (or undefined when no rules).
 */
export function generateAllComplianceRulesJson(): Record<string, ComplianceRulesJson> {
  const out: Record<string, ComplianceRulesJson> = {};
  for (const provider of listComplianceProviders()) {
    const json = generateComplianceRulesJson(provider);
    if (json) out[provider] = json;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Built-in compliance rules: Neon
// ---------------------------------------------------------------------------

registerComplianceRules({
  provider: "neon",
  title: "Neon Compliance Rules",
  description: "Semantic checks for Neon Postgres projects",
  preChecks: [],
  postChecks: [
    {
      id: "neon.region-match",
      title: "Neon project created in expected region",
      description:
        "Verifies that the provisioned project's region_id matches the caller's requested region hint. " +
        "A region mismatch causes latency and data-residency issues that are hard to diagnose later.",
      predicate(resource, hints) {
        const expectedRegion = hints?.region as string | undefined;
        if (!expectedRegion) return true; // no region hint → skip
        const actualRegion = resource?.region ?? (resource?.meta?.["region_id"] as string | undefined);
        return actualRegion === expectedRegion;
      },
      remediation(resource, hints) {
        const expected = hints?.region ?? "<unknown>";
        const actual = resource?.region ?? resource?.meta?.["region_id"] ?? "<unknown>";
        return (
          `Neon project was created in region "${actual}" but "${expected}" was requested. ` +
          `Delete the project and re-provision with the correct region, or update your stack config.`
        );
      },
    },
    {
      id: "neon.project-id-format",
      title: "Neon project id has expected format",
      description:
        "Neon project ids should be non-empty strings. An empty id indicates a malformed API response.",
      predicate(resource) {
        return typeof resource?.id === "string" && resource.id.length > 0;
      },
      remediation: "Neon returned an empty project id — this indicates an API error. Retry provisioning.",
    },
  ],
  blockers: [
    {
      id: "neon.free-tier-project-limit",
      title: "Neon free tier: at most 1 project per account",
      description:
        "Neon free-tier accounts are limited to 1 project. The hints object may carry " +
        "`neon_existing_project_count` set by the pre-provision check.",
      predicate(_resource, hints) {
        const existingCount = hints?.neon_existing_project_count as number | undefined;
        if (existingCount === undefined) return true; // no hint → cannot validate, skip
        // If the caller passed the count, a new project would exceed the limit
        // only if count >= 1 AND this is a fresh provision (no existingResourceId).
        const isFreeTier = hints?.neon_free_tier === true;
        if (!isFreeTier) return true;
        return existingCount < 1;
      },
      remediation:
        "Neon free-tier accounts support only 1 project. " +
        "Delete the existing project or upgrade to a paid plan before provisioning a new one.",
    },
  ],
  warnings: [
    {
      id: "neon.pg-version-recommended",
      title: "Neon project uses recommended PostgreSQL version (17+)",
      description: "Newer PostgreSQL versions receive security patches and performance improvements.",
      predicate(resource) {
        const pgVersion = resource?.meta?.["pg_version"] as number | undefined;
        if (pgVersion === undefined) return true; // unknown — no warning
        return pgVersion >= 17;
      },
      remediation:
        "Consider upgrading to PostgreSQL 17+ for the latest security patches and features. " +
        "You can change the pg_version at project creation time.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Built-in compliance rules: Stripe
// ---------------------------------------------------------------------------

registerComplianceRules({
  provider: "stripe",
  title: "Stripe Compliance Rules",
  description: "Semantic checks for Stripe account provisioning",
  preChecks: [],
  postChecks: [
    {
      id: "stripe.live-key-detection",
      title: "Stripe API key mode matches expected environment",
      description:
        "Stripe distinguishes test keys (sk_test_…) from live keys (sk_live_…). " +
        "Using a live key in a development stack can cause real charges.",
      predicate(resource, hints) {
        const expectedMode = hints?.stripe_key_mode as "test" | "live" | undefined;
        if (!expectedMode) return true; // no expectation set — skip
        // resource.meta.key_mode is set by the provider if it inspects the key prefix
        const actualMode = resource?.meta?.["key_mode"] as string | undefined;
        if (!actualMode) return true; // provider didn't set key_mode — skip
        return actualMode === expectedMode;
      },
      remediation(resource, hints) {
        const expected = hints?.stripe_key_mode ?? "test";
        const actual = resource?.meta?.["key_mode"] ?? "unknown";
        return (
          `Stripe key mode is "${actual}" but "${expected}" was expected. ` +
          `Check your STRIPE_SECRET_KEY value. Never use a live key in a development environment.`
        );
      },
    },
    {
      id: "stripe.account-id-format",
      title: "Stripe account id has valid format",
      description:
        "Stripe account ids start with 'acct_' for connected accounts, or may be 'default' " +
        "for the platform account. An empty id indicates an API error.",
      predicate(resource) {
        const id = resource?.id ?? "";
        return id.length > 0;
      },
      remediation: "Stripe returned an empty account id — this indicates an API error. Retry provisioning.",
    },
  ],
  blockers: [
    {
      id: "stripe.charges-enabled",
      title: "Stripe account has charges enabled",
      description:
        "An account without charges_enabled cannot process payments. This is usually caused by " +
        "incomplete onboarding or restricted account status.",
      predicate(resource, hints) {
        // Only enforce when the caller explicitly requires charges
        const requireCharges = hints?.stripe_require_charges_enabled === true;
        if (!requireCharges) return true;
        const chargesEnabled = resource?.meta?.["charges_enabled"];
        return chargesEnabled === true;
      },
      remediation:
        "Stripe account does not have charges enabled. Complete the Stripe onboarding flow " +
        "at https://dashboard.stripe.com/account and retry.",
    },
  ],
  warnings: [
    {
      id: "stripe.test-mode-recommended-for-dev",
      title: "Use Stripe test mode in non-production environments",
      description:
        "Live Stripe keys should only be used in production stacks.",
      predicate(resource, hints) {
        const environment = hints?.environment as string | undefined;
        if (!environment || environment === "production") return true;
        const keyMode = resource?.meta?.["key_mode"] as string | undefined;
        if (!keyMode) return true;
        return keyMode === "test";
      },
      remediation:
        "You appear to be using a live Stripe key in a non-production environment. " +
        "Switch to a test key (sk_test_…) to avoid accidental charges.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Built-in compliance rules: Anthropic
// ---------------------------------------------------------------------------

registerComplianceRules({
  provider: "anthropic",
  title: "Anthropic Compliance Rules",
  description: "Semantic checks for Anthropic API provisioning",
  preChecks: [
    {
      id: "anthropic.billing-configured",
      title: "Anthropic org must have billing configured before provisioning",
      description:
        "Without billing configured, Anthropic API calls fail with 402 errors after the " +
        "free-tier credits are exhausted. This check inspects the hints object for a " +
        "`anthropic_billing_confirmed` flag set by the caller or the login step.",
      predicate(_resource, hints) {
        // If caller explicitly confirmed billing, pass
        if (hints?.anthropic_billing_confirmed === true) return true;
        // If caller explicitly set it to false, fail
        if (hints?.anthropic_billing_confirmed === false) return false;
        // Unset — unknown, skip (non-blocking pre-check)
        return true;
      },
      remediation:
        "Configure billing at https://console.anthropic.com/settings/billing before " +
        "provisioning the Anthropic service. Pass `anthropic_billing_confirmed: true` " +
        "in hints once billing is set up.",
    },
  ],
  postChecks: [
    {
      id: "anthropic.api-key-format",
      title: "Anthropic API key has expected format",
      description:
        "Anthropic API keys start with 'sk-ant-'. An unexpected format may indicate " +
        "a copy-paste error or a test key being used in production.",
      predicate(resource, hints) {
        const rawKey = hints?.anthropic_api_key as string | undefined;
        if (!rawKey) return true; // key not passed in hints — skip
        return rawKey.startsWith("sk-ant-");
      },
      remediation:
        "The supplied Anthropic API key does not start with 'sk-ant-'. " +
        "Obtain a valid key from https://console.anthropic.com/settings/keys.",
    },
    {
      id: "anthropic.resource-id-present",
      title: "Anthropic resource id is non-empty",
      description: "A provisioned Anthropic resource must have a non-empty id.",
      predicate(resource) {
        return typeof resource?.id === "string" && resource.id.length > 0;
      },
      remediation:
        "Anthropic returned an empty resource id. This may indicate an API error or " +
        "a missing verification step. Retry provisioning.",
    },
  ],
  blockers: [],
  warnings: [
    {
      id: "anthropic.models-available",
      title: "Anthropic account has accessible models",
      description:
        "Validates that the account can see at least one model, confirming the API key " +
        "has the necessary permissions.",
      predicate(resource) {
        const models = resource?.meta?.["models"] as string | undefined;
        if (!models) return true; // not populated — skip
        const count = parseInt(models, 10);
        return !isNaN(count) && count > 0;
      },
      remediation:
        "No models are accessible on this Anthropic account. Verify that your API key " +
        "has the correct permissions and that your account is active.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Built-in compliance rules: AWS
// ---------------------------------------------------------------------------

registerComplianceRules({
  provider: "aws",
  title: "AWS Compliance Rules",
  description: "Semantic checks for AWS account provisioning",
  preChecks: [],
  postChecks: [
    {
      id: "aws.account-id-format",
      title: "AWS account id is a 12-digit number",
      description:
        "AWS account ids are always 12-digit numeric strings (e.g. '123456789012'). " +
        "An unexpected format indicates a misconfigured profile or STS response.",
      predicate(resource) {
        const accountId = resource?.meta?.["account_id"] as string | undefined;
        if (!accountId) {
          // Fall back to resource.id itself
          const id = resource?.id ?? "";
          return /^\d{12}$/.test(id);
        }
        return /^\d{12}$/.test(accountId);
      },
      remediation(resource) {
        const accountId =
          (resource?.meta?.["account_id"] as string | undefined) ?? resource?.id ?? "<unknown>";
        return (
          `AWS account id "${accountId}" does not match the expected 12-digit format. ` +
          `Verify your AWS_PROFILE / AWS credentials and ensure GetCallerIdentity returns a valid account.`
        );
      },
    },
    {
      id: "aws.arn-format",
      title: "AWS caller ARN has expected format",
      description:
        "AWS ARNs start with 'arn:aws:'. An unexpected ARN format may indicate " +
        "a cross-partition account (GovCloud, China) or a misconfigured identity.",
      predicate(resource) {
        const arn = resource?.meta?.["arn"] as string | undefined;
        if (!arn) return true; // ARN not present — skip
        return arn.startsWith("arn:aws:") || arn.startsWith("arn:aws-");
      },
      remediation(resource) {
        const arn = (resource?.meta?.["arn"] as string | undefined) ?? "<unknown>";
        return (
          `AWS caller ARN "${arn}" does not start with 'arn:aws:'. ` +
          `If you are using AWS GovCloud or China regions, this may be expected — " +
          "verify your region configuration.`
        );
      },
    },
  ],
  blockers: [],
  warnings: [
    {
      id: "aws.root-account-warning",
      title: "Avoid using AWS root account credentials",
      description:
        "Root account credentials have unrestricted access and should not be used for " +
        "day-to-day operations. Use IAM users or roles instead.",
      predicate(resource) {
        const arn = resource?.meta?.["arn"] as string | undefined;
        if (!arn) return true;
        // Root user ARNs look like: arn:aws:iam::123456789012:root
        return !arn.endsWith(":root");
      },
      remediation:
        "You appear to be using AWS root account credentials. " +
        "Create an IAM user or role with least-privilege permissions instead.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Pipeline integration helper
// ---------------------------------------------------------------------------

/**
 * Run post-provision compliance checks and throw a StackError on failure.
 * Called by the pipeline after provider.provision() returns a Resource but
 * before materialize().
 *
 * When a failure is detected and `deprovision` is provided, it is called
 * (best-effort) before the error is thrown so the upstream resource is
 * cleaned up automatically.
 *
 * Warnings are logged via `log` but never block the pipeline.
 */
export async function enforcePostCompliance(opts: {
  provider: string;
  resource: Resource;
  hints?: Record<string, unknown>;
  log: (level: "info" | "warn" | "error", msg: string) => void;
  deprovision?: () => Promise<void>;
}): Promise<ComplianceResult> {
  const result = runPostChecks(opts.provider, opts.resource, opts.hints);

  // Surface warnings (non-blocking)
  for (const w of result.warningOutcomes.filter((o) => !o.passed)) {
    opts.log(
      "warn",
      `[compliance] ${opts.provider}: advisory — ${w.checkTitle}${w.remediation ? `: ${w.remediation}` : ""}`,
    );
  }

  if (!result.passed) {
    // Build a human-friendly error message listing all failures
    const failureLines = [...result.preCheckOutcomes, ...result.postCheckOutcomes]
      .filter((o) => !o.passed)
      .map((o) => `  • [${o.checkId}] ${o.checkTitle}${o.remediation ? `\n    → ${o.remediation}` : ""}`)
      .join("\n");

    opts.log(
      "error",
      `[compliance] ${opts.provider}: post-provision compliance failed:\n${failureLines}`,
    );

    // Attempt best-effort deprovision (auto-delete the created resource)
    if (opts.deprovision) {
      try {
        await opts.deprovision();
        opts.log(
          "info",
          `[compliance] ${opts.provider}: auto-deleted resource ${opts.resource.id} after compliance failure.`,
        );
      } catch (cleanupErr) {
        opts.log(
          "warn",
          `[compliance] ${opts.provider}: failed to auto-delete resource ${opts.resource.id}: ${(cleanupErr as Error).message}. ` +
            `Delete it manually on the provider dashboard.`,
        );
      }
    }

    throw new StackError(
      "PROVISION_COMPLIANCE_FAILURE",
      `Provider "${opts.provider}" failed post-provision compliance checks:\n${failureLines}`,
    );
  }

  return result;
}

/**
 * Run pre-provision compliance checks and throw a StackError on failure.
 * Called BEFORE provider.provision() so no upstream resource is created.
 */
export function enforcePreCompliance(opts: {
  provider: string;
  hints?: Record<string, unknown>;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}): ComplianceResult {
  const result = runPreChecks(opts.provider, opts.hints);

  if (!result.passed) {
    const failureLines = result.preCheckOutcomes
      .filter((o) => !o.passed)
      .map((o) => `  • [${o.checkId}] ${o.checkTitle}${o.remediation ? `\n    → ${o.remediation}` : ""}`)
      .join("\n");

    opts.log(
      "error",
      `[compliance] ${opts.provider}: pre-provision compliance failed:\n${failureLines}`,
    );

    throw new StackError(
      "PRE_PROVISION_COMPLIANCE_FAILURE",
      `Provider "${opts.provider}" failed pre-provision compliance checks:\n${failureLines}`,
    );
  }

  return result;
}
