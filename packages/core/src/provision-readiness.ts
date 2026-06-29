/**
 * Provider Readiness Gate & Pre-Provision Input Validation Framework
 *
 * Implements a comprehensive pre-provision validation pipeline that checks
 * provider-side preconditions BEFORE credentials are used or resources are
 * created.  This is structurally parallel to provision-compliance.ts but
 * focused on *external* provider-state requirements (billing enabled, org
 * exists, region quota available, API limits) rather than post-provision
 * semantic checks.
 *
 * Key concepts
 * ------------
 *   ProviderReadinessRule   — a single named readiness requirement (hard) or
 *                             advisory (soft warning)
 *   ProviderReadinessRules  — per-provider rule set (hard + soft)
 *   ReadinessResult         — outcome of running all checks for one provider
 *
 * Entry points
 * ------------
 *   registerReadinessRules(rules)             — register rules for a provider
 *   getReadinessRules(provider)               — retrieve (or undefined)
 *   listReadinessProviders()                  — list all registered providers
 *   runReadinessChecks(provider, hints?)      — run all checks (hard + soft)
 *   enforceReadiness(opts)                    — run checks and throw on failure
 *   validateAllProviders(providers, hints?)   — batch check for `stack validate`
 *   generateReadinessJson(provider)           — codegen: emit readiness.json
 */

import { StackError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single readiness rule.  The predicate receives caller-supplied hints
 * (token info, quota snapshots, region targets, etc.) and returns true when
 * the requirement is satisfied.
 *
 * Rules run BEFORE any upstream API is called, so they receive no Resource.
 * They operate solely on `hints` (data collected at auth / login time).
 */
export interface ProviderReadinessRule {
  /** Machine-readable identifier, e.g. "vercel.billing-enabled". */
  id: string;
  /** Human label shown in CLI/log output. */
  title: string;
  /** Detailed explanation of what is being checked. */
  description: string;
  /**
   * Whether a failure blocks provisioning (hard) or is advisory (soft).
   *   "hard" — blocks the pipeline; provision() is NOT called.
   *   "soft" — surfaced as a warning; provision() still proceeds.
   */
  severity: "hard" | "soft";
  /**
   * Predicate: return true when the requirement is satisfied.
   * Receives optional caller hints populated at login/auth time.
   */
  predicate(hints?: Record<string, unknown>): boolean;
  /**
   * Actionable remediation message when the check fails.  May be a static
   * string or a function that builds a dynamic message from hints.
   */
  remediation: string | ((hints?: Record<string, unknown>) => string);
}

/**
 * Rule set for one provider.  Split into:
 *   hard  — blocking requirements (billing, org, quota, API availability)
 *   soft  — advisory warnings (near-quota, deprecated region, etc.)
 */
export interface ProviderReadinessRules {
  /** Provider name (lower-case, matches provision-schema registry key). */
  provider: string;
  /** Human label for documentation and output. */
  title: string;
  /** Short description of the overall readiness concern for this provider. */
  description?: string;
  hard: ProviderReadinessRule[];
  soft: ProviderReadinessRule[];
}

/** Outcome of a single readiness check. */
export interface ReadinessCheckOutcome {
  ruleId: string;
  ruleTitle: string;
  severity: "hard" | "soft";
  passed: boolean;
  /** Populated when passed === false. */
  remediation?: string;
}

/** Aggregated result of running all readiness checks for one provider. */
export interface ReadinessResult {
  provider: string;
  /** All hard-check outcomes. */
  hardOutcomes: ReadinessCheckOutcome[];
  /** All soft-check outcomes. */
  softOutcomes: ReadinessCheckOutcome[];
  /**
   * True only when ALL hard checks pass.
   * Soft failures never set this to false.
   */
  passed: boolean;
  /** IDs of failed hard checks. */
  blockingFailures: string[];
  /** IDs of failed soft checks (advisory). */
  advisories: string[];
}

/** Summary for batch `stack validate` output. */
export interface ProviderValidationSummary {
  provider: string;
  ready: boolean;
  blockingFailures: ReadinessCheckOutcome[];
  advisories: ReadinessCheckOutcome[];
}

/** Result of validating all configured providers at once. */
export interface BatchValidationResult {
  allReady: boolean;
  providers: ProviderValidationSummary[];
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const _readinessRegistry = new Map<string, ProviderReadinessRules>();

/** Register readiness rules for a provider. Idempotent — replaces on re-call. */
export function registerReadinessRules(rules: ProviderReadinessRules): void {
  _readinessRegistry.set(rules.provider.toLowerCase(), rules);
}

/** Retrieve registered readiness rules for a provider, or undefined. */
export function getReadinessRules(provider: string): ProviderReadinessRules | undefined {
  return _readinessRegistry.get(provider.toLowerCase());
}

/** List all providers with registered readiness rules (sorted). */
export function listReadinessProviders(): string[] {
  return [..._readinessRegistry.keys()].sort();
}

// ---------------------------------------------------------------------------
// Runner helpers
// ---------------------------------------------------------------------------

function resolveRemediation(
  rule: ProviderReadinessRule,
  hints?: Record<string, unknown>,
): string {
  if (typeof rule.remediation === "function") {
    return rule.remediation(hints);
  }
  return rule.remediation;
}

function runRules(
  rules: ProviderReadinessRule[],
  hints?: Record<string, unknown>,
): ReadinessCheckOutcome[] {
  return rules.map((rule) => {
    let passed = false;
    try {
      passed = rule.predicate(hints);
    } catch {
      passed = false;
    }
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      severity: rule.severity,
      passed,
      remediation: passed ? undefined : resolveRemediation(rule, hints),
    };
  });
}

function emptyReadinessResult(provider: string): ReadinessResult {
  return {
    provider,
    hardOutcomes: [],
    softOutcomes: [],
    passed: true,
    blockingFailures: [],
    advisories: [],
  };
}

// ---------------------------------------------------------------------------
// Public runner API
// ---------------------------------------------------------------------------

/**
 * Run all readiness checks (hard + soft) for a provider.
 * Returns a ReadinessResult; the caller should abort provision when
 * `result.passed === false` (i.e., any hard check failed).
 *
 * When no rules are registered for `provider`, returns a trivially-passing
 * result so that providers without rules are transparent to the pipeline.
 */
export function runReadinessChecks(
  provider: string,
  hints?: Record<string, unknown>,
): ReadinessResult {
  const rules = getReadinessRules(provider);
  if (!rules) {
    return emptyReadinessResult(provider);
  }

  const hardOutcomes = runRules(rules.hard, hints);
  const softOutcomes = runRules(rules.soft, hints);

  const blockingFailures = hardOutcomes
    .filter((o) => !o.passed)
    .map((o) => o.ruleId);
  const advisories = softOutcomes
    .filter((o) => !o.passed)
    .map((o) => o.ruleId);

  return {
    provider,
    hardOutcomes,
    softOutcomes,
    passed: blockingFailures.length === 0,
    blockingFailures,
    advisories,
  };
}

// ---------------------------------------------------------------------------
// Pipeline integration — enforceReadiness
// ---------------------------------------------------------------------------

/**
 * Run readiness checks and throw a StackError when any hard check fails.
 * Called by the pipeline AFTER auth but BEFORE provision() so no upstream
 * resource is created on failure.
 *
 * Soft failures are surfaced via `log` but never block the pipeline.
 */
export function enforceReadiness(opts: {
  provider: string;
  hints?: Record<string, unknown>;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}): ReadinessResult {
  const result = runReadinessChecks(opts.provider, opts.hints);

  // Surface soft warnings (non-blocking)
  for (const w of result.softOutcomes.filter((o) => !o.passed)) {
    opts.log(
      "warn",
      `[readiness] ${opts.provider}: advisory — ${w.ruleTitle}${w.remediation ? `: ${w.remediation}` : ""}`,
    );
  }

  if (!result.passed) {
    const failureLines = result.hardOutcomes
      .filter((o) => !o.passed)
      .map(
        (o) =>
          `  • [${o.ruleId}] ${o.ruleTitle}${o.remediation ? `\n    → ${o.remediation}` : ""}`,
      )
      .join("\n");

    opts.log(
      "error",
      `[readiness] ${opts.provider}: pre-provision readiness check failed:\n${failureLines}`,
    );

    throw new StackError(
      "PROVIDER_NOT_READY",
      `Provider "${opts.provider}" failed pre-provision readiness checks:\n${failureLines}`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Batch validation — `stack validate` entry point
// ---------------------------------------------------------------------------

/**
 * Validate readiness for a list of providers in one pass.
 * Used by the `stack validate` CLI command to check all configured providers
 * without provisioning anything.
 *
 * @param providers  List of provider names to check.
 * @param hints      Optional hints map (same keys as AddServiceOpts.hints).
 */
export function validateAllProviders(
  providers: string[],
  hints?: Record<string, unknown>,
): BatchValidationResult {
  const summaries: ProviderValidationSummary[] = providers.map((provider) => {
    const result = runReadinessChecks(provider, hints);
    return {
      provider,
      ready: result.passed,
      blockingFailures: result.hardOutcomes.filter((o) => !o.passed),
      advisories: result.softOutcomes.filter((o) => !o.passed),
    };
  });

  return {
    allReady: summaries.every((s) => s.ready),
    providers: summaries,
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ProviderNotReadyError extends Error {
  constructor(
    public readonly provider: string,
    public readonly result: ReadinessResult,
  ) {
    const failedRules = result.hardOutcomes.filter((o) => !o.passed);
    const summary = failedRules
      .slice(0, 3)
      .map(
        (o) =>
          `[${o.ruleId}] ${o.ruleTitle}${o.remediation ? ` — ${o.remediation}` : ""}`,
      )
      .join("; ");
    super(`Provider "${provider}" is not ready: ${summary}`);
    this.name = "ProviderNotReadyError";
  }
}

// ---------------------------------------------------------------------------
// Codegen: emit readiness.json descriptor
// ---------------------------------------------------------------------------

export interface ReadinessRulesJson {
  provider: string;
  title: string;
  description?: string;
  generatedAt: string;
  rules: {
    id: string;
    title: string;
    description: string;
    severity: "hard" | "soft";
    remediationTemplate?: string;
  }[];
}

/**
 * Generate a `readiness.json` descriptor for a provider.
 * Predicates are not serialized (they are functions); only metadata is emitted.
 */
export function generateReadinessJson(provider: string): ReadinessRulesJson | undefined {
  const rules = getReadinessRules(provider);
  if (!rules) return undefined;

  const mapRules = (ruleList: ProviderReadinessRule[]) =>
    ruleList.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      severity: r.severity,
      ...(typeof r.remediation === "string" ? { remediationTemplate: r.remediation } : {}),
    }));

  return {
    provider: rules.provider,
    title: rules.title,
    description: rules.description,
    generatedAt: new Date().toISOString(),
    rules: [...mapRules(rules.hard), ...mapRules(rules.soft)],
  };
}

/** Generate readiness.json descriptors for ALL registered providers. */
export function generateAllReadinessJson(): Record<string, ReadinessRulesJson> {
  const out: Record<string, ReadinessRulesJson> = {};
  for (const provider of listReadinessProviders()) {
    const json = generateReadinessJson(provider);
    if (json) out[provider] = json;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Built-in readiness rules: Vercel
// ---------------------------------------------------------------------------

registerReadinessRules({
  provider: "vercel",
  title: "Vercel Readiness Rules",
  description: "Pre-provision requirements for Vercel project provisioning",
  hard: [
    {
      id: "vercel.billing-enabled",
      title: "Vercel account must have billing configured",
      description:
        "Vercel Pro/Enterprise features (custom domains, team seats, higher limits) require " +
        "billing to be set up. Without billing, project creation may silently fail or be " +
        "restricted to Hobby tier. Pass `vercel_billing_enabled: true` in hints to confirm.",
      severity: "hard",
      predicate(hints) {
        // If the caller explicitly confirmed billing, pass.
        if (hints?.vercel_billing_enabled === true) return true;
        // If explicitly set to false, fail.
        if (hints?.vercel_billing_enabled === false) return false;
        // Unknown — skip (non-blocking when not explicitly checked).
        return true;
      },
      remediation:
        "Enable billing at https://vercel.com/account/billing before provisioning. " +
        "Pass `vercel_billing_enabled: true` in hints once billing is confirmed.",
    },
    {
      id: "vercel.team-exists",
      title: "Vercel team slug must exist when team provisioning is requested",
      description:
        "When provisioning under a Vercel team, the team must already exist. " +
        "Pass `vercel_team_id` in hints to specify the target team.",
      severity: "hard",
      predicate(hints) {
        // Only enforce when team provisioning is requested.
        // Note: undefined means personal account (skip); empty string is invalid.
        const teamId = hints?.vercel_team_id as string | undefined;
        if (teamId === undefined) return true; // personal account — skip
        return teamId.length > 0;
      },
      remediation(hints) {
        const teamId = hints?.vercel_team_id ?? "<empty>";
        return (
          `Vercel team id "${teamId}" is invalid or empty. ` +
          `Create the team at https://vercel.com/teams/create or pass a valid vercel_team_id.`
        );
      },
    },
  ],
  soft: [
    {
      id: "vercel.region-quota-warning",
      title: "Vercel serverless function region quota may be exhausted",
      description:
        "High function deployment counts in a single region can hit Vercel's soft quota limits, " +
        "causing delayed cold starts or deployment failures.",
      severity: "soft",
      predicate(hints) {
        const projectCount = hints?.vercel_existing_project_count as number | undefined;
        if (projectCount === undefined) return true; // unknown — no warning
        return projectCount < 40; // advisory threshold
      },
      remediation:
        "You have many existing Vercel projects. Consider distributing workloads across " +
        "multiple teams or cleaning up unused projects before provisioning more.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Built-in readiness rules: Stripe
// ---------------------------------------------------------------------------

registerReadinessRules({
  provider: "stripe",
  title: "Stripe Readiness Rules",
  description: "Pre-provision requirements for Stripe account provisioning",
  hard: [
    {
      id: "stripe.account-not-restricted",
      title: "Stripe account must not be in restricted mode",
      description:
        "A Stripe account in restricted mode cannot create webhooks, products, or prices. " +
        "Restricted accounts are typically new accounts pending identity verification or accounts " +
        "flagged for unusual activity. Pass `stripe_account_restricted: false` in hints to confirm.",
      severity: "hard",
      predicate(hints) {
        // If caller explicitly confirmed account is restricted, fail.
        if (hints?.stripe_account_restricted === true) return false;
        // Otherwise pass (unknown = non-blocking).
        return true;
      },
      remediation:
        "Your Stripe account is in restricted mode. Complete identity verification at " +
        "https://dashboard.stripe.com/account and resolve any outstanding action items " +
        "before provisioning Stripe resources.",
    },
    {
      id: "stripe.api-version-compatible",
      title: "Stripe API version must be compatible",
      description:
        "Stack requires a Stripe API version of 2020-08-27 or later. Older API versions " +
        "lack required features (e.g. Payment Intents, Price objects). " +
        "Pass `stripe_api_version` in hints to specify the account's pinned API version.",
      severity: "hard",
      predicate(hints) {
        const apiVersion = hints?.stripe_api_version as string | undefined;
        if (!apiVersion) return true; // unknown — skip
        // Parse the date string YYYY-MM-DD
        const date = new Date(apiVersion);
        const minDate = new Date("2020-08-27");
        return !isNaN(date.getTime()) && date >= minDate;
      },
      remediation(hints) {
        const version = hints?.stripe_api_version ?? "<unknown>";
        return (
          `Stripe API version "${version}" is too old. ` +
          `Update your Stripe account's API version to 2020-08-27 or later at ` +
          `https://dashboard.stripe.com/developers/api-version.`
        );
      },
    },
  ],
  soft: [
    {
      id: "stripe.test-mode-recommended",
      title: "Use Stripe test mode for non-production stacks",
      description:
        "Provisioning Stripe resources with a live key in a development environment " +
        "risks accidental real charges.",
      severity: "soft",
      predicate(hints) {
        const environment = hints?.environment as string | undefined;
        if (!environment || environment === "production") return true;
        const keyMode = hints?.stripe_key_mode as string | undefined;
        if (!keyMode) return true; // unknown — no warning
        return keyMode === "test";
      },
      remediation:
        "You appear to be provisioning Stripe in a non-production environment with a live key. " +
        "Use a test key (sk_test_…) to avoid accidental charges.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Built-in readiness rules: Supabase
// ---------------------------------------------------------------------------

registerReadinessRules({
  provider: "supabase",
  title: "Supabase Readiness Rules",
  description: "Pre-provision requirements for Supabase project provisioning",
  hard: [
    {
      id: "supabase.org-exists",
      title: "Supabase organization must exist before provisioning a project",
      description:
        "Supabase projects are created within organizations. If no organization exists, " +
        "project creation will fail with a 422 error. " +
        "Pass `supabase_org_id` in hints to target a specific organization.",
      severity: "hard",
      predicate(hints) {
        const orgId = hints?.supabase_org_id as string | undefined;
        // If caller explicitly passed an org ID, it must be non-empty.
        if (orgId !== undefined) return orgId.length > 0;
        // Unknown — skip (non-blocking when not explicitly checked).
        return true;
      },
      remediation(hints) {
        const orgId = hints?.supabase_org_id ?? "<empty>";
        return (
          `Supabase organization id "${orgId}" is invalid or empty. ` +
          `Create an organization at https://supabase.com/dashboard/new and pass a valid ` +
          `supabase_org_id in hints.`
        );
      },
    },
    {
      id: "supabase.quota-not-exceeded",
      title: "Supabase project quota must not be exceeded",
      description:
        "Supabase free-tier organizations are limited to 2 active projects. Attempting to " +
        "create a third project on a free org results in a quota error. " +
        "Pass `supabase_project_count` and `supabase_plan` in hints to check quota.",
      severity: "hard",
      predicate(hints) {
        const projectCount = hints?.supabase_project_count as number | undefined;
        const plan = hints?.supabase_plan as string | undefined;
        if (projectCount === undefined || plan === undefined) return true; // unknown — skip
        if (plan === "free") {
          return projectCount < 2;
        }
        // Pro/Team/Enterprise — higher limits, skip static check.
        return true;
      },
      remediation(hints) {
        const count = hints?.supabase_project_count ?? "?";
        return (
          `Supabase free-tier organizations support at most 2 active projects ` +
          `(current count: ${count}). ` +
          `Delete an existing project or upgrade to Pro at https://supabase.com/dashboard/org/billing.`
        );
      },
    },
  ],
  soft: [
    {
      id: "supabase.region-availability",
      title: "Supabase region should be available for new projects",
      description:
        "Some Supabase regions occasionally experience capacity constraints that may slow " +
        "project creation. Check https://status.supabase.com before provisioning in busy regions.",
      severity: "soft",
      predicate(hints) {
        const region = hints?.region as string | undefined;
        const unavailableRegions = hints?.supabase_unavailable_regions as string[] | undefined;
        if (!region || !unavailableRegions) return true;
        return !unavailableRegions.includes(region);
      },
      remediation(hints) {
        const region = hints?.region ?? "<unknown>";
        return (
          `Supabase region "${region}" may be experiencing capacity constraints. ` +
          `Check https://status.supabase.com or choose a different region.`
        );
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Built-in readiness rules: Neon
// ---------------------------------------------------------------------------

registerReadinessRules({
  provider: "neon",
  title: "Neon Readiness Rules",
  description: "Pre-provision requirements for Neon Postgres project provisioning",
  hard: [
    {
      id: "neon.project-quota-not-exceeded",
      title: "Neon free-tier account must have quota for a new project",
      description:
        "Neon free-tier accounts support only 1 project. Attempting to create a second " +
        "project on a free account fails immediately. " +
        "Pass `neon_existing_project_count` and `neon_free_tier` in hints to check quota.",
      severity: "hard",
      predicate(hints) {
        const isFreeTier = hints?.neon_free_tier === true;
        if (!isFreeTier) return true; // paid plan — no static limit to check
        const existingCount = hints?.neon_existing_project_count as number | undefined;
        if (existingCount === undefined) return true; // unknown — skip
        return existingCount < 1;
      },
      remediation:
        "Neon free-tier accounts support only 1 project. " +
        "Delete the existing project or upgrade to a paid plan before provisioning a new one.",
    },
    {
      id: "neon.region-valid",
      title: "Neon region must be a valid AWS region identifier",
      description:
        "Neon regions follow the pattern 'aws-<region>'. An invalid region identifier " +
        "causes project creation to fail with a 400 error.",
      severity: "hard",
      predicate(hints) {
        const region = hints?.region as string | undefined;
        if (!region) return true; // no region hint — skip
        return /^aws-[a-z]+-[a-z]+-\d+$/.test(region);
      },
      remediation(hints) {
        const region = hints?.region ?? "<unknown>";
        return (
          `Neon region "${region}" does not match the expected pattern (e.g. "aws-us-east-2"). ` +
          `Consult https://neon.tech/docs/introduction/regions for the list of supported regions.`
        );
      },
    },
  ],
  soft: [
    {
      id: "neon.pg-version-recommended",
      title: "Use PostgreSQL 17+ for new Neon projects",
      description:
        "PostgreSQL 17+ receives the latest security patches and performance improvements. " +
        "Older versions can still be provisioned but are not recommended for new projects.",
      severity: "soft",
      predicate(hints) {
        const pgVersion = hints?.neon_pg_version as number | undefined;
        if (pgVersion === undefined) return true; // unknown — no warning
        return pgVersion >= 17;
      },
      remediation:
        "Consider setting `neon_pg_version: 17` (or higher) in hints for the latest PostgreSQL version.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Built-in readiness rules: GitHub
// ---------------------------------------------------------------------------

registerReadinessRules({
  provider: "github",
  title: "GitHub Readiness Rules",
  description: "Pre-provision requirements for GitHub repository provisioning",
  hard: [
    {
      id: "github.org-membership-confirmed",
      title: "GitHub user must be a member of the target organization",
      description:
        "Provisioning a repository under a GitHub organization requires the authenticated user " +
        "to be at least a Member of that organization. " +
        "Pass `github_org` and `github_org_member: true` in hints to confirm.",
      severity: "hard",
      predicate(hints) {
        const org = hints?.github_org as string | undefined;
        if (!org) return true; // personal repo — no org check needed
        // If org is specified, membership must be confirmed.
        if (hints?.github_org_member === false) return false;
        return true; // unset = skip
      },
      remediation(hints) {
        const org = hints?.github_org ?? "<unknown>";
        return (
          `The authenticated GitHub user is not a member of organization "${org}". ` +
          `Request membership at https://github.com/orgs/${org}/people or use a personal account.`
        );
      },
    },
    {
      id: "github.api-rate-limit-ok",
      title: "GitHub API rate limit must have headroom",
      description:
        "GitHub REST API has a rate limit of 5000 requests/hour for authenticated users. " +
        "Provisioning during a near-exhausted window causes 429 errors. " +
        "Pass `github_rate_limit_remaining` in hints to check.",
      severity: "hard",
      predicate(hints) {
        const remaining = hints?.github_rate_limit_remaining as number | undefined;
        if (remaining === undefined) return true; // unknown — skip
        return remaining > 100; // require at least 100 requests headroom
      },
      remediation(hints) {
        const remaining = hints?.github_rate_limit_remaining ?? "?";
        const resetAt = hints?.github_rate_limit_reset ?? "<unknown>";
        return (
          `GitHub API rate limit is nearly exhausted (${remaining} requests remaining). ` +
          `Wait until the limit resets at ${resetAt} before provisioning.`
        );
      },
    },
  ],
  soft: [
    {
      id: "github.2fa-recommended",
      title: "Enable two-factor authentication on your GitHub account",
      description:
        "GitHub recommends 2FA for all accounts, and organizations may require it. " +
        "Without 2FA, repository access tokens may have reduced scopes.",
      severity: "soft",
      predicate(hints) {
        // Only warn when explicitly told 2FA is disabled.
        if (hints?.github_2fa_enabled === false) return false;
        return true;
      },
      remediation:
        "Enable two-factor authentication at https://github.com/settings/security to protect your account.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Built-in readiness rules: Anthropic
// ---------------------------------------------------------------------------

registerReadinessRules({
  provider: "anthropic",
  title: "Anthropic Readiness Rules",
  description: "Pre-provision requirements for Anthropic API provisioning",
  hard: [
    {
      id: "anthropic.billing-configured",
      title: "Anthropic account must have billing configured",
      description:
        "Without billing configured, Anthropic API calls fail with 402 errors after free-tier " +
        "credits are exhausted. Pass `anthropic_billing_confirmed: true` in hints to confirm.",
      severity: "hard",
      predicate(hints) {
        if (hints?.anthropic_billing_confirmed === true) return true;
        if (hints?.anthropic_billing_confirmed === false) return false;
        return true; // unknown — skip
      },
      remediation:
        "Configure billing at https://console.anthropic.com/settings/billing before " +
        "provisioning the Anthropic service.",
    },
    {
      id: "anthropic.api-key-format",
      title: "Anthropic API key must have the correct format (sk-ant-)",
      description:
        "Anthropic API keys start with 'sk-ant-'. An unexpected prefix indicates a " +
        "copy-paste error or a key from another provider.",
      severity: "hard",
      predicate(hints) {
        const key = hints?.anthropic_api_key as string | undefined;
        if (!key) return true; // no key hint — skip
        return key.startsWith("sk-ant-");
      },
      remediation:
        "The supplied Anthropic API key does not start with 'sk-ant-'. " +
        "Obtain a valid key from https://console.anthropic.com/settings/keys.",
    },
  ],
  soft: [
    {
      id: "anthropic.usage-tier-warning",
      title: "Anthropic usage tier may limit model access",
      description:
        "New Anthropic accounts start on Tier 1 which limits access to some models and " +
        "has lower rate limits. Consider requesting a tier upgrade for production workloads.",
      severity: "soft",
      predicate(hints) {
        const tier = hints?.anthropic_usage_tier as number | undefined;
        if (tier === undefined) return true;
        return tier >= 2; // tier 1 = advisory
      },
      remediation:
        "Your Anthropic account is on usage Tier 1. Request a tier upgrade at " +
        "https://console.anthropic.com/settings/limits for higher rate limits and model access.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Built-in readiness rules: OpenAI
// ---------------------------------------------------------------------------

registerReadinessRules({
  provider: "openai",
  title: "OpenAI Readiness Rules",
  description: "Pre-provision requirements for OpenAI API provisioning",
  hard: [
    {
      id: "openai.api-key-format",
      title: "OpenAI API key must have the correct format (sk-)",
      description:
        "OpenAI API keys start with 'sk-'. An unexpected format indicates a copy-paste error " +
        "or a key from another provider.",
      severity: "hard",
      predicate(hints) {
        const key = hints?.openai_api_key as string | undefined;
        if (!key) return true; // no key hint — skip
        return key.startsWith("sk-");
      },
      remediation:
        "The supplied OpenAI API key does not start with 'sk-'. " +
        "Obtain a valid key from https://platform.openai.com/api-keys.",
    },
    {
      id: "openai.billing-active",
      title: "OpenAI account must have an active billing method",
      description:
        "OpenAI API calls fail with 429 (quota exceeded) when billing is not set up or " +
        "the account has run out of credits.",
      severity: "hard",
      predicate(hints) {
        if (hints?.openai_billing_active === false) return false;
        return true; // unknown or true — skip
      },
      remediation:
        "Add a payment method at https://platform.openai.com/account/billing/payment-methods " +
        "before provisioning OpenAI resources.",
    },
  ],
  soft: [
    {
      id: "openai.rate-limit-tier",
      title: "OpenAI rate limit tier may constrain production workloads",
      description:
        "New OpenAI accounts start on the lowest usage tier with strict rate limits. " +
        "Production workloads may need a higher tier.",
      severity: "soft",
      predicate(hints) {
        const tier = hints?.openai_tier as number | undefined;
        if (tier === undefined) return true;
        return tier >= 2;
      },
      remediation:
        "Your OpenAI account may be on a low usage tier. " +
        "Visit https://platform.openai.com/account/limits to check and request upgrades.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Built-in readiness rules: AWS
// ---------------------------------------------------------------------------

registerReadinessRules({
  provider: "aws",
  title: "AWS Readiness Rules",
  description: "Pre-provision requirements for AWS account provisioning",
  hard: [
    {
      id: "aws.region-quota-available",
      title: "AWS region must have available service quota for the requested resource type",
      description:
        "AWS service quotas limit the number of resources per region (e.g. VPCs, Lambda " +
        "functions, S3 buckets). Exceeding a quota causes immediate provisioning failure. " +
        "Pass `aws_service_quota_ok: true` in hints to confirm quota is available.",
      severity: "hard",
      predicate(hints) {
        if (hints?.aws_service_quota_ok === false) return false;
        return true; // unknown or true — skip
      },
      remediation:
        "The requested AWS service quota may be exhausted in the target region. " +
        "Check quotas at https://console.aws.amazon.com/servicequotas and request an increase " +
        "if needed before provisioning.",
    },
    {
      id: "aws.credentials-valid",
      title: "AWS credentials must be valid and non-expired",
      description:
        "Expired or invalid AWS credentials cause immediate provisioning failure. " +
        "Pass `aws_credentials_valid: true` in hints to confirm credentials are current.",
      severity: "hard",
      predicate(hints) {
        if (hints?.aws_credentials_valid === false) return false;
        return true; // unknown — skip
      },
      remediation:
        "Your AWS credentials are invalid or expired. Run `aws sts get-caller-identity` to " +
        "verify, then refresh them via `aws sso login` or by rotating your access keys.",
    },
  ],
  soft: [
    {
      id: "aws.root-credentials-warning",
      title: "Avoid using AWS root account credentials",
      description:
        "Root credentials have unrestricted access. Use an IAM user or role with " +
        "least-privilege permissions instead.",
      severity: "soft",
      predicate(hints) {
        if (hints?.aws_is_root_credentials === true) return false;
        return true;
      },
      remediation:
        "You appear to be using AWS root credentials. Create an IAM user or role with " +
        "least-privilege permissions at https://console.aws.amazon.com/iam.",
    },
  ],
});
