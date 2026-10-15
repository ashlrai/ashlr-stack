/**
 * Template reference — one entry per starter stack in `templates/<name>/stack.toml`.
 *
 * The `services` arrays match the `[services.*]` blocks in each template;
 * they're what `stack templates apply <name>` iterates over.
 */

export interface TemplateServiceRef {
  /** Service name (the TOML section key). */
  name: string;
  /** The provider key (usually same as service name). */
  provider: string;
  /** The secret slots the template declares. */
  secrets: string[];
  /** The MCP server name, when the template wires one. */
  mcp?: string;
}

export interface TemplateRef {
  name: string;
  displayName: string;
  tagline: string;
  /** Longer description for the per-template card. */
  blurb: string;
  services: TemplateServiceRef[];
  /** Environments defined in the template (dev/prod split, etc). */
  environments: string[];
  /** Good-fit sentence — who this template is for. */
  goodFor: string;
}

export const TEMPLATES_REF: TemplateRef[] = [
  {
    name: "nextjs-supabase-posthog",
    displayName: "Next.js · Supabase · PostHog",
    tagline: "Postgres + auth + product analytics.",
    blurb:
      "Starter definitions for Supabase data/auth and PostHog analytics. Available MCP entries depend on provider setup and separately configured client credentials.",
    services: [
      {
        name: "supabase",
        provider: "supabase",
        secrets: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
        mcp: "supabase",
      },
      {
        name: "posthog",
        provider: "posthog",
        secrets: ["POSTHOG_PROJECT_API_KEY", "POSTHOG_PERSONAL_API_KEY"],
        mcp: "posthog",
      },
    ],
    environments: ["dev", "prod"],
    goodFor: "Teams planning a data, auth and analytics stack with provider-specific setup.",
  },
  {
    name: "nextjs-neon-vercel-sentry",
    displayName: "Next.js · Neon · Vercel · Sentry",
    tagline: "Serverless Postgres, deploy, error tracking.",
    blurb:
      "Starter definitions for Neon, Vercel and Sentry. Sentry setup selects an existing project; available MCP configuration still needs usable client credentials.",
    services: [
      {
        name: "neon",
        provider: "neon",
        secrets: ["NEON_API_KEY", "DATABASE_URL"],
      },
      {
        name: "vercel",
        provider: "vercel",
        secrets: ["VERCEL_TOKEN"],
      },
      {
        name: "sentry",
        provider: "sentry",
        secrets: ["SENTRY_AUTH_TOKEN", "SENTRY_DSN", "SENTRY_ORG", "SENTRY_PROJECT"],
        mcp: "sentry",
      },
    ],
    environments: ["dev", "prod"],
    goodFor: "Next.js apps on Vercel that need a real Postgres + production error tracking.",
  },
  {
    name: "supabase-posthog-sentry-resend",
    displayName: "Supabase · PostHog · Sentry · Resend · Stripe",
    tagline: 'The "SaaS in a box" template.',
    blurb:
      "Starter definitions for data/auth, analytics, errors, email and payments. Each service needs its supported setup; listed MCP entries do not establish running clients or working credentials.",
    services: [
      {
        name: "supabase",
        provider: "supabase",
        secrets: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
        mcp: "supabase",
      },
      {
        name: "posthog",
        provider: "posthog",
        secrets: ["POSTHOG_PERSONAL_API_KEY"],
        mcp: "posthog",
      },
      {
        name: "sentry",
        provider: "sentry",
        secrets: ["SENTRY_AUTH_TOKEN", "SENTRY_DSN", "SENTRY_ORG", "SENTRY_PROJECT"],
        mcp: "sentry",
      },
      {
        name: "resend",
        provider: "resend",
        secrets: ["RESEND_API_KEY"],
      },
      {
        name: "stripe",
        provider: "stripe",
        secrets: ["STRIPE_SECRET_KEY"],
      },
    ],
    environments: ["dev", "prod"],
    goodFor:
      "SaaS projects planning payment and error-monitoring integrations to configure and verify.",
  },
  {
    name: "cloudflare-turso-clerk",
    displayName: "Cloudflare · Turso · Clerk · Sentry",
    tagline: "Edge deployment, database and auth definitions.",
    blurb:
      "Service definitions for Turso, Cloudflare, Clerk and Sentry. Available MCP configuration depends on adapter results and client setup.",
    services: [
      {
        name: "cloudflare",
        provider: "cloudflare",
        secrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
      },
      {
        name: "turso",
        provider: "turso",
        secrets: ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "TURSO_PLATFORM_TOKEN"],
      },
      {
        name: "clerk",
        provider: "clerk",
        secrets: ["CLERK_SECRET_KEY"],
      },
      {
        name: "sentry",
        provider: "sentry",
        secrets: ["SENTRY_AUTH_TOKEN", "SENTRY_DSN", "SENTRY_ORG", "SENTRY_PROJECT"],
        mcp: "sentry",
      },
    ],
    environments: ["dev", "prod"],
    goodFor: "Edge apps planning database, deployment, auth and error-monitoring integrations.",
  },
  {
    name: "claude-agent-openai-anthropic",
    displayName: "Claude agent (OpenAI · Anthropic · xAI · DeepSeek · GitHub)",
    tagline: "Multi-model agent project.",
    blurb:
      "Provider slots for OpenAI, Anthropic, xAI, DeepSeek and GitHub. Supply supported account credentials; available GitHub MCP configuration needs separate client setup.",
    services: [
      { name: "openai", provider: "openai", secrets: ["OPENAI_API_KEY"] },
      { name: "anthropic", provider: "anthropic", secrets: ["ANTHROPIC_API_KEY"] },
      { name: "xai", provider: "xai", secrets: ["XAI_API_KEY"] },
      { name: "deepseek", provider: "deepseek", secrets: ["DEEPSEEK_API_KEY"] },
      { name: "github", provider: "github", secrets: ["GITHUB_TOKEN"], mcp: "github" },
    ],
    environments: ["dev"],
    goodFor: "Agent projects planning model API access and a GitHub integration.",
  },
];
