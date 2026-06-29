/**
 * Dry-Run Engine
 *
 * Intercepts provider provision() / materialize() / login() calls and returns
 * synthetic but realistic resource mocks without making any upstream API calls,
 * writing secrets to Phantom, or touching .mcp.json / .stack.toml.
 *
 * Key entry points:
 *   - `dryRunProvider(providerName, opts)`   — run a single provider dry-run
 *   - `dryRunProviders(names, opts)`         — batch (used by `stack apply --dry-run`)
 *   - `formatDryRunReport(report)`           — human-readable table string
 *   - `formatDryRunReportJson(report)`       — machine-readable JSON string
 *
 * Cost estimation (--cost-estimate):
 *   - Providers may expose a static `estimateMonthlyCost()` function.
 *   - `dryRunProvider` calls it when `opts.costEstimate` is true and attaches
 *     the result to `DryRunResourceResult.costEstimate`.
 *   - STRATEGY.md Moat 2 envisions calling live provider MCPs at recommend-time;
 *     this lays the groundwork with a static fallback registry that can be
 *     swapped for real MCP calls once those integrations land.
 */

import type { ServiceEntry } from "./config.ts";
import type { Resource } from "./providers/_base.ts";
import { getProvider } from "./providers/index.ts";
import { getProviderSchema, validateSchemaCompleteness } from "./provision-schema.ts";

// ---------------------------------------------------------------------------
// Cost estimation registry
// ---------------------------------------------------------------------------

export interface CostEstimate {
  /** Provider name (e.g. "supabase") */
  provider: string;
  /** Estimated monthly cost in USD. null = unknown / dynamic. */
  monthlyUsd: number | null;
  /** Human-readable breakdown or notes (e.g. "Free tier available; paid from $25/mo") */
  notes: string;
  /** Tier or plan name used for the estimate (e.g. "free", "pro", "usage-based") */
  tier: string;
  /** Whether this estimate is static (from registry) or live (from a pricing MCP). */
  source: "static" | "mcp";
}

/**
 * Static cost registry. Values are intentionally conservative estimates for a
 * new project on the lowest paid tier. Real-time pricing requires Moat 2 MCP
 * calls (STRATEGY.md); this registry provides a useful fallback.
 *
 * Format: provider name → CostEstimate (without the `provider` field).
 */
const STATIC_COST_REGISTRY: Record<
  string,
  Omit<CostEstimate, "provider" | "source">
> = {
  supabase: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Free tier: 500 MB DB, 1 GB storage, 2 GB bandwidth. Pro plan from $25/mo.",
  },
  neon: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Free tier: 0.5 GB storage, 1 compute unit. Launch plan from $19/mo.",
  },
  vercel: {
    monthlyUsd: 0,
    tier: "hobby",
    notes: "Hobby tier: free for personal projects. Pro from $20/mo per member.",
  },
  stripe: {
    monthlyUsd: null,
    tier: "usage-based",
    notes: "Usage-based: 2.9% + 30¢ per successful card charge. No monthly base fee.",
  },
  github: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Free for public repos. GitHub Team from $4/user/mo.",
  },
  openai: {
    monthlyUsd: null,
    tier: "usage-based",
    notes:
      "Usage-based: pay per token. gpt-4o: $2.50/1M input + $10/1M output tokens (as of 2025).",
  },
  anthropic: {
    monthlyUsd: null,
    tier: "usage-based",
    notes:
      "Usage-based: pay per token. Claude Sonnet 4: $3/1M input + $15/1M output tokens (as of 2025).",
  },
  upstash: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Free tier: 10k commands/day. Pay-as-you-go from $0.2/100k commands.",
  },
  resend: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Free tier: 3,000 emails/mo. Pro from $20/mo (50k emails).",
  },
  turso: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Free tier: 500 DBs, 9 GB storage. Scaler from $29/mo.",
  },
  railway: {
    monthlyUsd: 5,
    tier: "hobby",
    notes: "Hobby plan: $5/mo, includes $5 usage credit. Pro from $20/mo.",
  },
  fly: {
    monthlyUsd: 0,
    tier: "pay-as-you-go",
    notes:
      "Pay-as-you-go. Shared-cpu-1x @ 256 MB ≈ $1.94/mo. Free allowance: 3 shared VMs.",
  },
  cloudflare: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Workers free tier: 100k requests/day. Paid from $5/mo (10M requests).",
  },
  planetscale: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Hobby free tier. Scaler from $39/mo.",
  },
  sentry: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Developer (free): 5k errors/mo. Team from $26/mo.",
  },
  posthog: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Free: 1M events/mo included. Scale tier for higher volumes.",
  },
  datastax: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Serverless Astra DB free tier: 5 GB storage, 40M reads/writes per month.",
  },
  aws: {
    monthlyUsd: null,
    tier: "usage-based",
    notes: "Usage-based. Free tier available for 12 months on many services.",
  },
  gcp: {
    monthlyUsd: null,
    tier: "usage-based",
    notes: "Usage-based. $300 free credits for new accounts; always-free tier for some services.",
  },
  firebase: {
    monthlyUsd: 0,
    tier: "spark",
    notes: "Spark (free): 1 GB Firestore storage. Blaze pay-as-you-go for overages.",
  },
  loops: {
    monthlyUsd: 0,
    tier: "free",
    notes: "Free: up to 1,000 contacts. From $49/mo for higher volumes.",
  },
};

/**
 * Get the static cost estimate for a provider, if available.
 */
export function getStaticCostEstimate(providerName: string): CostEstimate | undefined {
  const entry = STATIC_COST_REGISTRY[providerName.toLowerCase()];
  if (!entry) return undefined;
  return { provider: providerName, source: "static", ...entry };
}

// ---------------------------------------------------------------------------
// Synthetic resource / secret generation
// ---------------------------------------------------------------------------

/**
 * Generate a realistic synthetic resource ID for a provider.
 * IDs match the format real provider APIs return so tests / previews look realistic.
 */
function syntheticResourceId(providerName: string): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  const hex = (n: number) =>
    [...Array(n)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
  const nanoid = () => rand() + rand();

  const templates: Record<string, () => string> = {
    supabase: () => nanoid().slice(0, 20),
    neon: () => `${rand()}-${rand()}-${rand()}-${rand()}-${rand()}`,
    vercel: () => `prj_${nanoid()}`,
    stripe: () => `acct_${nanoid()}`,
    github: () => `gh-${rand()}`,
    openai: () => `org-${nanoid()}`,
    anthropic: () => `org_${nanoid()}`,
    upstash: () => hex(8) + "-" + hex(4) + "-" + hex(4) + "-" + hex(4) + "-" + hex(12),
    resend: () => `re_${nanoid()}`,
    turso: () => `turso-${rand()}-${rand()}`,
    railway: () => hex(8) + "-" + hex(4) + "-" + hex(4) + "-" + hex(4) + "-" + hex(12),
    fly: () => `${rand()}-${rand()}`,
    cloudflare: () => hex(32),
    sentry: () => `${rand()}`,
    posthog: () => `phc_${nanoid()}`,
    aws: () => `arn:aws:iam::${Math.floor(Math.random() * 1e12)}:root`,
    gcp: () => `projects/${rand()}-${rand()}`,
    firebase: () => `${rand()}-${rand()}`,
  };

  const gen = templates[providerName.toLowerCase()];
  return gen ? gen() : `${providerName}-${nanoid()}`;
}

/**
 * Generate synthetic but realistic secret values for a provider.
 * Values are clearly fake (contain "[DRY-RUN]") but match real secret key naming.
 */
function syntheticSecrets(providerName: string): Record<string, string> {
  const REDACTED = "[REDACTED]";

  const secretTemplates: Record<string, Record<string, string>> = {
    supabase: {
      SUPABASE_URL: `https://[DRY-RUN].supabase.co`,
      SUPABASE_ANON_KEY: REDACTED,
      SUPABASE_SERVICE_ROLE_KEY: REDACTED,
    },
    neon: {
      DATABASE_URL: `postgresql://neondb_owner:[DRY-RUN]@ep-[DRY-RUN].us-east-2.aws.neon.tech/neondb?sslmode=require`,
    },
    vercel: {
      VERCEL_TOKEN: REDACTED,
      VERCEL_PROJECT_ID: `prj_[DRY-RUN]`,
      VERCEL_TEAM_ID: `team_[DRY-RUN]`,
    },
    stripe: {
      STRIPE_SECRET_KEY: REDACTED,
      STRIPE_PUBLISHABLE_KEY: `pk_test_[DRY-RUN]`,
    },
    github: {
      GITHUB_TOKEN: REDACTED,
    },
    openai: {
      OPENAI_API_KEY: REDACTED,
    },
    anthropic: {
      ANTHROPIC_API_KEY: REDACTED,
    },
    upstash: {
      UPSTASH_REDIS_REST_URL: `https://[DRY-RUN].upstash.io`,
      UPSTASH_REDIS_REST_TOKEN: REDACTED,
    },
    resend: {
      RESEND_API_KEY: REDACTED,
    },
    turso: {
      TURSO_DATABASE_URL: `libsql://[DRY-RUN].turso.io`,
      TURSO_AUTH_TOKEN: REDACTED,
    },
    railway: {
      RAILWAY_TOKEN: REDACTED,
    },
    fly: {
      FLY_API_TOKEN: REDACTED,
    },
    cloudflare: {
      CLOUDFLARE_API_TOKEN: REDACTED,
      CLOUDFLARE_ACCOUNT_ID: `[DRY-RUN]`,
    },
    sentry: {
      SENTRY_DSN: `https://[DRY-RUN]@o[DRY-RUN].ingest.sentry.io/[DRY-RUN]`,
      SENTRY_AUTH_TOKEN: REDACTED,
    },
    posthog: {
      POSTHOG_KEY: `phc_[DRY-RUN]`,
      POSTHOG_HOST: `https://app.posthog.com`,
    },
  };

  return secretTemplates[providerName.toLowerCase()] ?? { [`${providerName.toUpperCase()}_API_KEY`]: REDACTED };
}

/**
 * Generate a synthetic MCP entry for a provider (if the real provider would
 * emit one). Returns undefined for providers that don't register MCP servers.
 */
function syntheticMcpEntry(
  providerName: string,
  resourceId: string,
): { name: string; command: string; args: string[] } | undefined {
  const mcpTemplates: Record<
    string,
    (id: string) => { name: string; command: string; args: string[] }
  > = {
    supabase: (id) => ({
      name: "supabase",
      command: "npx",
      args: ["-y", "@supabase/mcp-server-supabase", "--project-ref", id],
    }),
    neon: () => ({
      name: "neon",
      command: "npx",
      args: ["-y", "@neondatabase/mcp-server-neon"],
    }),
    github: () => ({
      name: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
    }),
  };

  const gen = mcpTemplates[providerName.toLowerCase()];
  return gen ? gen(resourceId) : undefined;
}

// ---------------------------------------------------------------------------
// DryRunResourceResult — single provider result
// ---------------------------------------------------------------------------

export interface DryRunResourceResult {
  /** Provider name */
  provider: string;
  /** Provider display name */
  displayName: string;
  /** Provider category */
  category: string;
  /** Auth mechanism */
  authKind: string;
  /** Synthetic resource that would be created */
  resource: Resource;
  /** Secret keys that would be stored in Phantom (values are [REDACTED]) */
  secrets: Record<string, string>;
  /** MCP entry that would be written to .mcp.json, if applicable */
  mcpEntry?: { name: string; command: string; args: string[] };
  /** Whether .stack.toml would be updated */
  wouldPersistConfig: boolean;
  /** Schema validation result for the synthetic resource */
  schemaValidation: {
    hasSchema: boolean;
    valid: boolean;
    issues: string[];
  };
  /** Cost estimate (only present when opts.costEstimate is true) */
  costEstimate?: CostEstimate;
}

// ---------------------------------------------------------------------------
// DryRunReport — batch result
// ---------------------------------------------------------------------------

export interface DryRunReport {
  /** ISO timestamp of when the dry-run was executed */
  generatedAt: string;
  /** List of providers that were dry-run */
  providers: DryRunResourceResult[];
  /** Total count of secrets that would be stored */
  totalSecrets: number;
  /** Total count of MCP entries that would be wired */
  totalMcpEntries: number;
  /** Aggregated cost estimate (only present when costEstimate: true) */
  totalCostEstimate?: {
    /** Sum of providers with known monthlyUsd. null = at least one is unknown. */
    monthlyUsd: number | null;
    /** Human-readable notes per provider */
    breakdown: Array<{ provider: string; monthlyUsd: number | null; notes: string }>;
  };
}

// ---------------------------------------------------------------------------
// Core dry-run logic
// ---------------------------------------------------------------------------

export interface DryRunProviderOpts {
  /** Whether to include cost estimates in the output */
  costEstimate?: boolean;
  /** Existing resource id (skip creation, attach to this id) */
  existingResourceId?: string;
  /** Provider-specific hints */
  hints?: Record<string, unknown>;
}

/**
 * Run a dry-run for a single provider. No upstream API calls are made.
 * Returns a `DryRunResourceResult` describing what would happen.
 */
export async function dryRunProvider(
  providerName: string,
  opts: DryRunProviderOpts = {},
): Promise<DryRunResourceResult> {
  const provider = await getProvider(providerName);

  // Generate synthetic resource
  const resourceId = opts.existingResourceId ?? syntheticResourceId(providerName);
  const resource: Resource = {
    id: resourceId,
    displayName: `${provider.displayName} (dry-run)`,
    region: (opts.hints?.region as string | undefined) ?? undefined,
    meta: {
      dry_run: true,
      created_at: new Date().toISOString(),
    },
  };

  // Synthetic secrets (all values are [REDACTED])
  const secrets = syntheticSecrets(providerName);

  // Synthetic MCP entry
  const mcpEntry = syntheticMcpEntry(providerName, resourceId);

  // Schema validation against provision-schema registry
  const completeness = validateSchemaCompleteness(providerName);
  const schemaValidation = {
    hasSchema: completeness.hasSchema,
    valid: completeness.hasSchema && completeness.issues.length === 0,
    issues: completeness.issues,
  };

  // Cost estimate (optional)
  let costEstimate: CostEstimate | undefined;
  if (opts.costEstimate) {
    costEstimate = getStaticCostEstimate(providerName);
    if (!costEstimate) {
      // Fallback for providers not in the static registry
      costEstimate = {
        provider: providerName,
        monthlyUsd: null,
        tier: "unknown",
        notes: `No pricing data available for "${providerName}". Check provider docs.`,
        source: "static",
      };
    }
  }

  return {
    provider: provider.name,
    displayName: provider.displayName,
    category: provider.category,
    authKind: provider.authKind,
    resource,
    secrets,
    mcpEntry,
    wouldPersistConfig: true,
    schemaValidation,
    costEstimate,
  };
}

/**
 * Run a dry-run for multiple providers and build an aggregated `DryRunReport`.
 */
export async function dryRunProviders(
  providerNames: string[],
  opts: DryRunProviderOpts = {},
): Promise<DryRunReport> {
  const results = await Promise.all(
    providerNames.map((name) => dryRunProvider(name, opts)),
  );

  const totalSecrets = results.reduce((sum, r) => sum + Object.keys(r.secrets).length, 0);
  const totalMcpEntries = results.filter((r) => r.mcpEntry !== undefined).length;

  let totalCostEstimate: DryRunReport["totalCostEstimate"] | undefined;
  if (opts.costEstimate) {
    const breakdown = results
      .filter((r) => r.costEstimate !== undefined)
      .map((r) => ({
        provider: r.provider,
        monthlyUsd: r.costEstimate!.monthlyUsd,
        notes: r.costEstimate!.notes,
      }));

    const hasUnknown = breakdown.some((b) => b.monthlyUsd === null);
    const knownSum = breakdown.reduce<number>(
      (sum, b) => sum + (b.monthlyUsd ?? 0),
      0,
    );

    totalCostEstimate = {
      monthlyUsd: hasUnknown ? null : knownSum,
      breakdown,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    providers: results,
    totalSecrets,
    totalMcpEntries,
    totalCostEstimate,
  };
}

// ---------------------------------------------------------------------------
// Output formatters
// ---------------------------------------------------------------------------

/**
 * Format a DryRunReport as a human-readable table string.
 * Suitable for CLI output (no color codes — callers wrap with chalk/kleur).
 */
export function formatDryRunReport(report: DryRunReport): string {
  const lines: string[] = [];

  lines.push("DRY-RUN PREVIEW");
  lines.push("═".repeat(60));
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Providers: ${report.providers.length}`);
  lines.push(`Secrets:   ${report.totalSecrets} keys would be stored in Phantom`);
  lines.push(`MCP:       ${report.totalMcpEntries} server(s) would be wired`);
  lines.push("");

  for (const r of report.providers) {
    lines.push(`┌─ ${r.displayName} (${r.provider})`);
    lines.push(`│  category  : ${r.category}`);
    lines.push(`│  auth      : ${r.authKind}`);
    lines.push(`│  resource  : ${r.resource.id}${r.resource.region ? ` [${r.resource.region}]` : ""}`);

    if (Object.keys(r.secrets).length > 0) {
      lines.push(`│  secrets   : ${Object.keys(r.secrets).join(", ")}`);
      for (const [key, val] of Object.entries(r.secrets)) {
        lines.push(`│    ${key} = ${val}`);
      }
    } else {
      lines.push(`│  secrets   : (none)`);
    }

    if (r.mcpEntry) {
      lines.push(`│  mcp       : ${r.mcpEntry.name} → ${r.mcpEntry.command} ${r.mcpEntry.args.join(" ")}`);
    } else {
      lines.push(`│  mcp       : (not wired)`);
    }

    lines.push(`│  config    : .stack.toml would be updated`);

    if (r.schemaValidation.hasSchema) {
      const status = r.schemaValidation.valid ? "✓ valid" : `✗ issues: ${r.schemaValidation.issues.join("; ")}`;
      lines.push(`│  schema    : ${status}`);
    } else {
      lines.push(`│  schema    : (no schema registered for this provider)`);
    }

    if (r.costEstimate) {
      const cost =
        r.costEstimate.monthlyUsd !== null
          ? `$${r.costEstimate.monthlyUsd.toFixed(2)}/mo`
          : "dynamic pricing";
      lines.push(`│  cost est. : ${cost} [${r.costEstimate.tier}] — ${r.costEstimate.notes}`);
    }

    lines.push("└" + "─".repeat(59));
    lines.push("");
  }

  if (report.totalCostEstimate) {
    lines.push("COST ESTIMATE SUMMARY");
    lines.push("─".repeat(60));
    const total =
      report.totalCostEstimate.monthlyUsd !== null
        ? `$${report.totalCostEstimate.monthlyUsd.toFixed(2)}/mo`
        : "variable (at least one provider has usage-based pricing)";
    lines.push(`Total estimated monthly cost: ${total}`);
    lines.push("");
    for (const b of report.totalCostEstimate.breakdown) {
      const cost = b.monthlyUsd !== null ? `$${b.monthlyUsd.toFixed(2)}/mo` : "dynamic";
      lines.push(`  ${b.provider.padEnd(20)} ${cost}`);
    }
    lines.push("");
  }

  lines.push("NOTE: This is a dry-run. No resources were created, no secrets stored.");

  return lines.join("\n");
}

/**
 * Serialize a DryRunReport to a JSON string (pretty-printed for CI/programmatic use).
 */
export function formatDryRunReportJson(report: DryRunReport): string {
  return JSON.stringify(report, null, 2);
}

// ---------------------------------------------------------------------------
// Pipeline integration helpers
// ---------------------------------------------------------------------------

/**
 * Minimal subset of AddServiceOpts needed for the dry-run path in pipeline.ts.
 */
export interface DryRunAddServiceOpts {
  providerName: string;
  existingResourceId?: string;
  hints?: Record<string, unknown>;
  costEstimate?: boolean;
}

/**
 * Dry-run variant of `addService` (pipeline.ts). Returns the same shape as the
 * real AddServiceResult so callers can render it consistently, but no
 * upstream API calls, secrets, MCP entries, or config writes are performed.
 */
export async function dryRunAddService(opts: DryRunAddServiceOpts): Promise<{
  providerName: string;
  resourceId: string;
  displayName: string;
  secretCount: number;
  mcpWired: boolean;
  dryRun: true;
  report: DryRunResourceResult;
  entry: ServiceEntry;
}> {
  const result = await dryRunProvider(opts.providerName, {
    existingResourceId: opts.existingResourceId,
    hints: opts.hints,
    costEstimate: opts.costEstimate,
  });

  const entry: ServiceEntry = {
    provider: result.provider,
    resource_id: result.resource.id,
    secrets: Object.keys(result.secrets),
    mcp: result.mcpEntry?.name,
    meta: result.resource.meta,
    created_at: new Date().toISOString(),
    created_by: "stack add --dry-run",
  };

  return {
    providerName: result.provider,
    resourceId: result.resource.id,
    displayName: result.displayName,
    secretCount: Object.keys(result.secrets).length,
    mcpWired: result.mcpEntry !== undefined,
    dryRun: true,
    report: result,
    entry,
  };
}
