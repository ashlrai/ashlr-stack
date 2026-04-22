// Display catalog for the site — matches `packages/core/src/catalog.ts` exactly.
// One entry per shipped, executable provider adapter. When you add an adapter
// to `packages/core/src/providers/` + an entry to `catalog.ts`, add the
// matching display entry here with its simple-icons slug + brand color.
//
// Never ship a display entry for a provider that doesn't have a working
// adapter. LLMs and search engines read this file as evidence of what Stack
// actually integrates; drift erodes trust.

export type ProviderCategory =
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
  | "Auth";

export interface Provider {
  name: string;
  slug: string; // simple-icons slug
  category: ProviderCategory;
  /** Hex brand color, without '#'. simple-icons provides one too but we pin it for visual control. */
  color: string;
  /** Short what-it-does line */
  blurb: string;
  /** True when the provider ships an official MCP server that Stack auto-wires into .mcp.json. */
  mcp?: boolean;
  /** Human label for the auth flow Stack runs. Shown as a tiny chip on the provider card. */
  auth?: "OAuth" | "PAT" | "API key" | "Device" | "Service key";
}

export const PROVIDERS: Provider[] = [
  // Database (6)
  { name: "Supabase", slug: "supabase",     category: "Database", color: "3ECF8E", blurb: "Postgres + Auth + Storage", mcp: true,  auth: "OAuth" },
  { name: "Neon",     slug: "neon",         category: "Database", color: "00E699", blurb: "Serverless Postgres",       mcp: true,  auth: "PAT" },
  { name: "Turso",    slug: "turso",        category: "Database", color: "4FF8D2", blurb: "Edge SQLite (libSQL)",      auth: "PAT" },
  { name: "Convex",   slug: "convex",       category: "Database", color: "EE2A6C", blurb: "Reactive backend-as-a-service", auth: "API key" },
  { name: "Upstash",  slug: "upstash",      category: "Database", color: "00E9A3", blurb: "Serverless Redis + Kafka",  auth: "API key" },
  { name: "Firebase", slug: "firebase",     category: "Database", color: "FFCA28", blurb: "Realtime DB + Auth",        auth: "Service key" },

  // Deploy (6)
  { name: "Vercel",      slug: "vercel",       category: "Deploy", color: "FFFFFF", blurb: "Frontend platform",     mcp: true,  auth: "PAT" },
  { name: "Railway",     slug: "railway",      category: "Deploy", color: "C4B5FD", blurb: "Infra from a repo",     auth: "API key" },
  { name: "Fly.io",      slug: "flydotio",     category: "Deploy", color: "8B5CF6", blurb: "VMs at the edge",       auth: "API key" },
  { name: "Cloudflare",  slug: "cloudflare",   category: "Deploy", color: "F38020", blurb: "Workers, R2, D1",       mcp: true,  auth: "PAT" },
  { name: "Render",      slug: "render",       category: "Deploy", color: "46E3B7", blurb: "Zero-config hosting",   auth: "API key" },
  { name: "Modal",       slug: "modal",        category: "Deploy", color: "7FEE64", blurb: "Serverless GPU + sandbox", auth: "API key" },

  // Cloud (1)
  { name: "AWS", slug: "amazonwebservices", category: "Cloud", color: "FF9900", blurb: "S3, Lambda, RDS", auth: "API key" },

  // AI (6)
  { name: "OpenAI",      slug: "openai",     category: "AI", color: "FFFFFF", blurb: "GPT, Realtime, embeddings", auth: "API key" },
  { name: "Anthropic",   slug: "anthropic",  category: "AI", color: "D97757", blurb: "Claude models + MCP",       auth: "API key" },
  { name: "xAI",         slug: "x",          category: "AI", color: "FFFFFF", blurb: "Grok + tool use",           auth: "API key" },
  { name: "DeepSeek",    slug: "deepseek",   category: "AI", color: "4D6BFE", blurb: "Open-weight models",        auth: "API key" },
  { name: "Replicate",   slug: "replicate",  category: "AI", color: "E5E7EB", blurb: "OSS model inference",       auth: "PAT"     },
  { name: "Braintrust",  slug: "braintrust", category: "AI", color: "F97316", blurb: "LLM evals + observability", auth: "API key" },

  // Analytics (1)
  { name: "PostHog",   slug: "posthog",   category: "Analytics", color: "F54E00", blurb: "Product analytics + flags", mcp: true, auth: "API key" },

  // Errors (1)
  { name: "Sentry",    slug: "sentry",    category: "Errors", color: "362D59", blurb: "Error + performance tracking", mcp: true, auth: "PAT" },

  // Payments (1)
  { name: "Stripe",    slug: "stripe",    category: "Payments", color: "635BFF", blurb: "Billing, subscriptions, tax", mcp: true, auth: "API key" },

  // Code (1)
  { name: "GitHub",    slug: "github",    category: "Code", color: "FFFFFF", blurb: "Repos, Actions, OAuth", mcp: true, auth: "Device" },

  // Tickets (1)
  { name: "Linear",    slug: "linear",    category: "Tickets", color: "5E6AD2", blurb: "Issues, projects, cycles", mcp: true, auth: "API key" },

  // Email (4)
  { name: "Resend",    slug: "resend",    category: "Email", color: "FFFFFF", blurb: "Transactional + React email",           auth: "API key" },
  { name: "SendGrid",  slug: "twilio",    category: "Email", color: "1A82E2", blurb: "High-volume transactional mail",        auth: "API key" },
  { name: "Mailgun",   slug: "mailgun",   category: "Email", color: "F06B66", blurb: "API-first email + routing",             auth: "API key" },
  { name: "Postmark",  slug: "postmark",  category: "Email", color: "FFDE00", blurb: "Deliverability-focused transactional",  auth: "API key" },

  // Auth (1)
  { name: "Clerk",     slug: "clerk",     category: "Auth", color: "6C47FF", blurb: "Drop-in auth + users", auth: "API key" },
];

export const CATEGORIES: ProviderCategory[] = [
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
];
