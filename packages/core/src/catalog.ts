/**
 * Canonical provider reference catalog for Stack.
 *
 * This is the single source of truth for provider display metadata — shared
 * between the CLI, the MCP server, the AI recommender (`packages/core/src/ai/`),
 * and the site's docs (`packages/site/src/lib/providers-ref.ts` re-exports
 * from here).
 *
 * Executable provider adapters live in `packages/core/src/providers/*.ts`.
 * When adding a provider, update both (the adapter for behavior, this catalog
 * for metadata/docs/AI context).
 */

export type CatalogAuthKind = "oauth_pkce" | "oauth_device" | "pat" | "api_key";

export interface ProviderRef {
  /** Matches the CLI provider name (what you type after `stack add`). */
  name: string;
  displayName: string;
  category:
    | "Database"
    | "Deploy"
    | "Cloud"
    | "AI"
    | "Analytics"
    | "Errors"
    | "Payments"
    | "Code"
    | "Tickets"
    | "Email"
    | "Auth"
    | "Features";
  authKind: CatalogAuthKind;
  /** Canonical .env names this provider writes into Phantom. */
  secrets: string[];
  /** Short one-liner describing what you get. */
  blurb: string;
  /** When truthy, Stack wires an MCP entry for this provider. */
  mcp?: {
    name: string;
    /** Marks this MCP entry as pre-alpha / best-effort. */
    preview?: boolean;
    detail: string;
  };
  /** Dashboard URL `stack open <name>` lands on. */
  dashboard: string;
  /** Upstream reference docs URL for when something goes wrong. */
  docs: string;
  /** How auth works, from the user's perspective. One short sentence. */
  howTo: string;
  /** Free-form note about v1 limitations or caveats. */
  notes?: string;
}

/** Back-compat re-export for call sites that still use `AuthKind`. */
export type AuthKind = CatalogAuthKind;

export const PROVIDERS_REF: ProviderRef[] = [
  // ── Database ──────────────────────────────────────────────────────────────
  {
    name: "supabase",
    displayName: "Supabase",
    category: "Database",
    authKind: "oauth_pkce",
    secrets: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    blurb: "Postgres + Auth + Storage. Full upstream provisioning via the Management API.",
    mcp: {
      name: "supabase",
      detail:
        "@supabase/mcp-server-supabase scoped to the new project ref, with SUPABASE_ACCESS_TOKEN piped from Phantom.",
    },
    dashboard: "https://supabase.com/dashboard",
    docs: "https://supabase.com/docs/reference/api/introduction",
    howTo: "Browser OAuth (PKCE) via the Ashlr Stack app.",
    notes:
      "v1 provisions a project and fetches service keys. Database password is auto-generated and stored in Phantom.",
  },
  {
    name: "neon",
    displayName: "Neon",
    category: "Database",
    authKind: "pat",
    secrets: ["NEON_API_KEY", "DATABASE_URL"],
    blurb: "Serverless Postgres. Creates a project and pools the connection string.",
    dashboard: "https://console.neon.tech",
    docs: "https://neon.tech/docs/reference/api-reference",
    howTo: "Paste a personal API key from https://console.neon.tech/app/settings/api-keys.",
  },
  {
    name: "turso",
    displayName: "Turso",
    category: "Database",
    authKind: "pat",
    secrets: ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "TURSO_PLATFORM_TOKEN"],
    blurb: "Edge SQLite (libSQL). Creates a database in your default org.",
    dashboard: "https://app.turso.tech",
    docs: "https://docs.turso.tech",
    howTo: "Paste a platform token from https://app.turso.tech/account/api-tokens.",
  },
  {
    name: "convex",
    displayName: "Convex",
    category: "Database",
    authKind: "api_key",
    secrets: ["CONVEX_DEPLOY_KEY"],
    blurb: "Reactive backend-as-a-service. Deploy key stored in Phantom.",
    dashboard: "https://dashboard.convex.dev",
    docs: "https://docs.convex.dev",
    howTo: "Create a deploy key in the Convex dashboard and paste it.",
  },
  {
    name: "upstash",
    displayName: "Upstash",
    category: "Database",
    authKind: "api_key",
    secrets: ["UPSTASH_MANAGEMENT_TOKEN"],
    blurb: "Serverless Redis + Kafka. Management token stored in Phantom.",
    dashboard: "https://console.upstash.com",
    docs: "https://upstash.com/docs/devops/developer-api",
    howTo: "Generate a management token from the Upstash console.",
  },
  {
    name: "firebase",
    displayName: "Firebase",
    category: "Database",
    authKind: "api_key",
    secrets: ["FIREBASE_SERVICE_ACCOUNT_JSON"],
    blurb: "Realtime DB + Auth. Service-account JSON stored verbatim in Phantom.",
    dashboard: "https://console.firebase.google.com",
    docs: "https://firebase.google.com/docs/admin/setup",
    howTo:
      "Paste the full service-account JSON from Firebase → Project settings → Service accounts.",
  },

  // ── Deploy ────────────────────────────────────────────────────────────────
  {
    name: "vercel",
    displayName: "Vercel",
    category: "Deploy",
    authKind: "pat",
    secrets: ["VERCEL_TOKEN"],
    blurb: "Frontend platform. Stores a scoped access token for deploys + env sync.",
    dashboard: "https://vercel.com/dashboard",
    docs: "https://vercel.com/docs/rest-api",
    howTo: "Paste a personal access token from https://vercel.com/account/tokens.",
  },
  {
    name: "railway",
    displayName: "Railway",
    category: "Deploy",
    authKind: "api_key",
    secrets: ["RAILWAY_TOKEN"],
    blurb: "Infra from a repo. Project-level token stored in Phantom.",
    dashboard: "https://railway.app/dashboard",
    docs: "https://docs.railway.app/reference/public-api",
    howTo: "Paste an API token from https://railway.app/account/tokens.",
  },
  {
    name: "fly",
    displayName: "Fly.io",
    category: "Deploy",
    authKind: "api_key",
    secrets: ["FLY_API_TOKEN"],
    blurb: "VMs at the edge. Machines API token stored in Phantom.",
    dashboard: "https://fly.io/dashboard",
    docs: "https://fly.io/docs/machines/api",
    howTo: "Paste an API token from https://fly.io/user/personal_access_tokens.",
  },
  {
    name: "cloudflare",
    displayName: "Cloudflare",
    category: "Deploy",
    authKind: "pat",
    secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    blurb: "Workers, R2, D1. Account id inferred from the token's scope.",
    dashboard: "https://dash.cloudflare.com",
    docs: "https://developers.cloudflare.com/api",
    howTo: "Create a scoped API token at https://dash.cloudflare.com/profile/api-tokens.",
  },
  {
    name: "render",
    displayName: "Render",
    category: "Deploy",
    authKind: "api_key",
    secrets: ["RENDER_API_KEY"],
    blurb: "Zero-config hosting. API key stored in Phantom.",
    dashboard: "https://dashboard.render.com",
    docs: "https://api-docs.render.com",
    howTo: "Generate a key at https://dashboard.render.com/u/settings#api-keys.",
  },

  // ── Cloud ─────────────────────────────────────────────────────────────────
  {
    name: "aws",
    displayName: "AWS",
    category: "Cloud",
    authKind: "api_key",
    secrets: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    blurb: "S3, Lambda, RDS. IAM access keys stored in Phantom.",
    dashboard: "https://console.aws.amazon.com",
    docs: "https://docs.aws.amazon.com/iam/",
    howTo: "Create an IAM access key pair in the AWS console and paste both halves.",
    notes: "v1 stores the keys only — no resource provisioning. Scope the IAM policy narrowly.",
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  {
    name: "openai",
    displayName: "OpenAI",
    category: "AI",
    authKind: "api_key",
    secrets: ["OPENAI_API_KEY"],
    blurb: "GPT, Realtime, embeddings. Key verified against /v1/models on paste.",
    dashboard: "https://platform.openai.com",
    docs: "https://platform.openai.com/docs/api-reference",
    howTo: "Paste a secret key from https://platform.openai.com/api-keys.",
  },
  {
    name: "anthropic",
    displayName: "Anthropic",
    category: "AI",
    authKind: "api_key",
    secrets: ["ANTHROPIC_API_KEY"],
    blurb: "Claude models + MCP. Key verified against the Messages API on paste.",
    dashboard: "https://console.anthropic.com",
    docs: "https://docs.anthropic.com/en/api",
    howTo: "Paste a secret key from https://console.anthropic.com/settings/keys.",
  },
  {
    name: "xai",
    displayName: "xAI",
    category: "AI",
    authKind: "api_key",
    secrets: ["XAI_API_KEY"],
    blurb: "Grok + tool use. Key verified on paste.",
    dashboard: "https://console.x.ai",
    docs: "https://docs.x.ai/api",
    howTo: "Paste a key from https://console.x.ai.",
  },
  {
    name: "deepseek",
    displayName: "DeepSeek",
    category: "AI",
    authKind: "api_key",
    secrets: ["DEEPSEEK_API_KEY"],
    blurb: "Open-weight models. Key verified on paste.",
    dashboard: "https://platform.deepseek.com",
    docs: "https://api-docs.deepseek.com",
    howTo: "Paste a key from https://platform.deepseek.com/api_keys.",
  },

  // ── Analytics ─────────────────────────────────────────────────────────────
  {
    name: "posthog",
    displayName: "PostHog",
    category: "Analytics",
    authKind: "api_key",
    secrets: ["POSTHOG_PERSONAL_API_KEY"],
    blurb: "Product analytics + flags. Personal API key stored in Phantom.",
    mcp: {
      name: "posthog",
      detail:
        "SSE MCP at mcp.posthog.com/sse, with the personal key piped through Phantom at call time.",
    },
    dashboard: "https://app.posthog.com",
    docs: "https://posthog.com/docs/api",
    howTo: "Create a personal API key at https://app.posthog.com/me/settings (scope: all).",
  },

  // ── Errors ────────────────────────────────────────────────────────────────
  {
    name: "sentry",
    displayName: "Sentry",
    category: "Errors",
    authKind: "pat",
    secrets: ["SENTRY_AUTH_TOKEN", "SENTRY_DSN", "SENTRY_ORG", "SENTRY_PROJECT"],
    blurb: "Error + performance tracking. Creates a project and fetches its DSN.",
    mcp: {
      name: "sentry",
      detail:
        "@sentry/mcp-server with SENTRY_AUTH_TOKEN piped from Phantom and SENTRY_HOST defaulting to sentry.io.",
    },
    dashboard: "https://sentry.io",
    docs: "https://docs.sentry.io/api/",
    howTo:
      "Paste an auth token from https://sentry.io/settings/account/api/auth-tokens/ (scopes: project:read, project:write).",
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  {
    name: "stripe",
    displayName: "Stripe",
    category: "Payments",
    authKind: "api_key",
    secrets: ["STRIPE_SECRET_KEY"],
    blurb: "Billing, subscriptions, tax. Restricted / test-mode secret key stored in Phantom.",
    dashboard: "https://dashboard.stripe.com",
    docs: "https://docs.stripe.com/api",
    howTo:
      "Create a restricted key at https://dashboard.stripe.com/apikeys (use test mode for development).",
    notes:
      "v1 only stores the key. Full Stripe Connect / account linking lands when we register the Ashlr OAuth app.",
  },

  // ── Code ──────────────────────────────────────────────────────────────────
  {
    name: "github",
    displayName: "GitHub",
    category: "Code",
    authKind: "oauth_device",
    secrets: ["GITHUB_TOKEN"],
    blurb: "Repos, Actions, OAuth. Device-flow token stored in Phantom.",
    mcp: {
      name: "github",
      detail:
        "@modelcontextprotocol/server-github with GITHUB_PERSONAL_ACCESS_TOKEN piped from Phantom.",
    },
    dashboard: "https://github.com",
    docs: "https://docs.github.com/en/rest",
    howTo: "Browser device-code flow — enter the code GitHub shows you, authorise, done.",
  },

  // ── Tickets ───────────────────────────────────────────────────────────────
  {
    name: "linear",
    displayName: "Linear",
    category: "Tickets",
    authKind: "api_key",
    secrets: ["LINEAR_API_KEY"],
    blurb: "Issues, projects, cycles. Personal API key stored in Phantom.",
    mcp: {
      name: "linear",
      detail: "mcp-linear with LINEAR_API_KEY piped from Phantom.",
    },
    dashboard: "https://linear.app",
    docs: "https://developers.linear.app/docs",
    howTo: "Create a personal API key at https://linear.app/settings/api.",
  },

  // ── Email ─────────────────────────────────────────────────────────────────
  {
    name: "resend",
    displayName: "Resend",
    category: "Email",
    authKind: "api_key",
    secrets: ["RESEND_API_KEY"],
    blurb: "Transactional + React Email. API key stored in Phantom.",
    dashboard: "https://resend.com",
    docs: "https://resend.com/docs",
    howTo: "Paste an API key from https://resend.com/api-keys.",
  },
  {
    name: "sendgrid",
    displayName: "SendGrid",
    category: "Email",
    authKind: "api_key",
    secrets: ["SENDGRID_API_KEY"],
    blurb: "High-volume transactional mail. API key verified against /v3/scopes on paste.",
    dashboard: "https://app.sendgrid.com",
    docs: "https://docs.sendgrid.com/api-reference",
    howTo: "Paste an API key from https://app.sendgrid.com/settings/api_keys.",
  },
  {
    name: "mailgun",
    displayName: "Mailgun",
    category: "Email",
    authKind: "api_key",
    secrets: ["MAILGUN_API_KEY"],
    blurb: "API-first email + routing. Key verified against /v3/domains on paste (HTTP Basic).",
    dashboard: "https://app.mailgun.com",
    docs: "https://documentation.mailgun.com/docs/mailgun/api-reference/",
    howTo: "Paste an API key from https://app.mailgun.com/settings/api_security.",
  },
  {
    name: "postmark",
    displayName: "Postmark",
    category: "Email",
    authKind: "api_key",
    secrets: ["POSTMARK_ACCOUNT_TOKEN"],
    blurb:
      "Deliverability-focused transactional. Account token verified against /servers on paste.",
    dashboard: "https://account.postmarkapp.com",
    docs: "https://postmarkapp.com/developer/api/overview",
    howTo: "Paste an account token from https://account.postmarkapp.com/api_tokens.",
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  {
    name: "clerk",
    displayName: "Clerk",
    category: "Auth",
    authKind: "api_key",
    secrets: ["CLERK_SECRET_KEY"],
    blurb: "Drop-in auth + users. Secret key stored in Phantom.",
    dashboard: "https://dashboard.clerk.com",
    docs: "https://clerk.com/docs",
    howTo: "Paste a secret key from https://dashboard.clerk.com (API Keys).",
  },
];

export const PROVIDER_CATEGORIES = [
  "Database",
  "Deploy",
  "Cloud",
  "AI",
  "Analytics",
  "Errors",
  "Payments",
  "Code",
  "Tickets",
  "Email",
  "Auth",
] as const;

export function groupByCategory(): Record<string, ProviderRef[]> {
  const out: Record<string, ProviderRef[]> = {};
  for (const p of PROVIDERS_REF) {
    let bucket = out[p.category];
    if (!bucket) {
      bucket = [];
      out[p.category] = bucket;
    }
    bucket.push(p);
  }
  return out;
}

export function findProviderRef(name: string): ProviderRef | undefined {
  return PROVIDERS_REF.find((p) => p.name === name);
}
