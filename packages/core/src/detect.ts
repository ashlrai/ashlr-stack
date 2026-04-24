/**
 * Given the name of an env var, guess which curated provider owns it. Used by
 * `stack import` to auto-wire existing .env files into Stack's service map.
 *
 * Heuristics are deliberately conservative — if the match isn't obvious we
 * return `undefined` and the caller stores the secret without associating it
 * with any provider. Users can always `stack add <name>` later to reconcile.
 */

import type { ServiceEntry } from "./config.ts";

export interface DetectedService {
  provider: string;
  secrets: string[];
  mcp?: string;
}

interface DetectionRule {
  provider: string;
  mcp?: string;
  /** Match a single env var name to this provider. */
  matches: (name: string) => boolean;
  /** Optional: pick the "primary" secret name that implies the service is present. */
  primary?: (name: string) => boolean;
}

const RULES: DetectionRule[] = [
  {
    provider: "supabase",
    mcp: "supabase",
    matches: (n) => /^(NEXT_PUBLIC_)?SUPABASE_(URL|ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET)$/.test(n),
    primary: (n) => /^(NEXT_PUBLIC_)?SUPABASE_URL$/.test(n),
  },
  {
    // DATABASE_URL is intentionally NOT attributed here — it's a generic
    // Postgres convention used by Supabase, Railway, Render, PlanetScale,
    // and plain self-hosted Postgres. Only NEON_* keys identify Neon.
    provider: "neon",
    matches: (n) => /^NEON_/.test(n),
    primary: (n) => n === "NEON_API_KEY",
  },
  {
    provider: "vercel",
    matches: (n) => /^VERCEL_/.test(n),
    primary: (n) => n === "VERCEL_TOKEN",
  },
  {
    provider: "railway",
    matches: (n) => /^RAILWAY_/.test(n),
    primary: (n) => n === "RAILWAY_TOKEN",
  },
  { provider: "fly", matches: (n) => /^FLY_/.test(n), primary: (n) => n === "FLY_API_TOKEN" },
  {
    provider: "upstash",
    matches: (n) => /^UPSTASH_/.test(n),
    primary: (n) => n === "UPSTASH_MANAGEMENT_TOKEN",
  },
  {
    provider: "openai",
    matches: (n) => /^OPENAI_/.test(n),
    primary: (n) => n === "OPENAI_API_KEY",
  },
  {
    provider: "anthropic",
    matches: (n) => /^ANTHROPIC_/.test(n),
    primary: (n) => n === "ANTHROPIC_API_KEY",
  },
  { provider: "xai", matches: (n) => /^XAI_/.test(n), primary: (n) => n === "XAI_API_KEY" },
  {
    provider: "deepseek",
    matches: (n) => /^DEEPSEEK_/.test(n),
    primary: (n) => n === "DEEPSEEK_API_KEY",
  },
  {
    provider: "posthog",
    mcp: "posthog",
    matches: (n) => /^(NEXT_PUBLIC_)?POSTHOG_/.test(n),
    primary: (n) => n === "POSTHOG_PERSONAL_API_KEY",
  },
  {
    provider: "sentry",
    mcp: "sentry",
    matches: (n) => /^SENTRY_/.test(n) || /^(NEXT_PUBLIC_)?SENTRY_DSN$/.test(n),
    primary: (n) => n === "SENTRY_AUTH_TOKEN",
  },
  {
    provider: "github",
    mcp: "github",
    matches: (n) => /^GITHUB_(TOKEN|PERSONAL_ACCESS_TOKEN)$/.test(n),
    primary: (n) => n === "GITHUB_TOKEN",
  },
  {
    provider: "linear",
    mcp: "linear",
    matches: (n) => /^LINEAR_/.test(n),
    primary: (n) => n === "LINEAR_API_KEY",
  },
  {
    provider: "stripe",
    matches: (n) => /^STRIPE_/.test(n),
    primary: (n) => n === "STRIPE_SECRET_KEY",
  },
  {
    provider: "resend",
    matches: (n) => /^RESEND_/.test(n),
    primary: (n) => n === "RESEND_API_KEY",
  },
  {
    provider: "clerk",
    matches: (n) => /^CLERK_/.test(n) || /^NEXT_PUBLIC_CLERK_/.test(n),
    primary: (n) => n === "CLERK_SECRET_KEY",
  },
  {
    provider: "aws",
    matches: (n) => /^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|REGION|SESSION_TOKEN)$/.test(n),
    primary: (n) => n === "AWS_ACCESS_KEY_ID",
  },
  {
    provider: "cloudflare",
    matches: (n) => /^CLOUDFLARE_(API_TOKEN|ACCOUNT_ID|ZONE_ID)$/.test(n) || /^CF_/.test(n),
    primary: (n) => n === "CLOUDFLARE_API_TOKEN",
  },
  {
    provider: "turso",
    matches: (n) => /^TURSO_(DATABASE_URL|AUTH_TOKEN|PLATFORM_TOKEN)$/.test(n),
    primary: (n) => n === "TURSO_DATABASE_URL",
  },
  {
    provider: "convex",
    matches: (n) => /^(NEXT_PUBLIC_)?CONVEX_(URL|DEPLOY_KEY)$/.test(n),
    primary: (n) => n === "CONVEX_DEPLOY_KEY",
  },
  {
    provider: "render",
    matches: (n) => /^RENDER_/.test(n),
    primary: (n) => n === "RENDER_API_KEY",
  },
  {
    provider: "firebase",
    matches: (n) => /^FIREBASE_/.test(n),
    primary: (n) => n === "FIREBASE_SERVICE_ACCOUNT_JSON",
  },
  {
    provider: "replicate",
    matches: (n) => /^REPLICATE_/.test(n),
    primary: (n) => n === "REPLICATE_API_TOKEN",
  },
  {
    provider: "braintrust",
    matches: (n) => /^BRAINTRUST_/.test(n),
    primary: (n) => n === "BRAINTRUST_API_KEY",
  },
  {
    provider: "modal",
    matches: (n) => /^MODAL_/.test(n),
    primary: (n) => n === "MODAL_TOKEN",
  },
];

export function detectProvider(envName: string): string | undefined {
  const rule = RULES.find((r) => r.matches(envName));
  return rule?.provider;
}

export function groupByProvider(envNames: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const name of envNames) {
    const provider = detectProvider(name);
    if (!provider) continue;
    if (!out[provider]) out[provider] = [];
    out[provider].push(name);
  }
  return out;
}

export function mcpForProvider(provider: string): string | undefined {
  return RULES.find((r) => r.provider === provider && r.mcp)?.mcp;
}

/**
 * Build a minimal ServiceEntry from a detected group of env vars. The caller
 * is responsible for attaching provider-specific metadata (resource_id,
 * region) later via `stack doctor --fix` or a manual edit.
 */
export function toServiceEntry(provider: string, secrets: string[]): ServiceEntry {
  return {
    provider,
    secrets,
    mcp: mcpForProvider(provider),
    created_at: new Date().toISOString(),
    created_by: "stack import",
  };
}

/** Lightweight .env parser (no interpolation, no export support — good enough for import). */
export function parseEnv(text: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) continue;
    out.push({ key, value });
  }
  return out;
}
