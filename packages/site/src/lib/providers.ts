// Curated v1 provider catalog for Ashlr Stack.
// Each entry is authoritative for what is rendered on the site.
// The `slug` is the simple-icons slug; we'll lookup at build time.

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
}

export const PROVIDERS: Provider[] = [
  // Database
  { name: "Supabase", slug: "supabase",     category: "Database", color: "3ECF8E", blurb: "Postgres + Auth + Storage" },
  { name: "Neon",     slug: "postgresql",   category: "Database", color: "00E699", blurb: "Serverless Postgres" },
  { name: "Turso",    slug: "turso",        category: "Database", color: "4FF8D2", blurb: "Edge SQLite (libSQL)" },
  { name: "Convex",   slug: "convex",       category: "Database", color: "EE2A6C", blurb: "Reactive backend-as-a-service" },
  { name: "Upstash",  slug: "upstash",      category: "Database", color: "00E9A3", blurb: "Serverless Redis + Kafka" },
  { name: "Firebase", slug: "firebase",     category: "Database", color: "FFCA28", blurb: "Realtime DB + Auth" },

  // Deploy
  { name: "Vercel",      slug: "vercel",       category: "Deploy", color: "FFFFFF", blurb: "Frontend platform" },
  { name: "Railway",     slug: "railway",      category: "Deploy", color: "C4B5FD", blurb: "Infra from a repo" },
  { name: "Fly.io",      slug: "flydotio",     category: "Deploy", color: "8B5CF6", blurb: "VMs at the edge" },
  { name: "Cloudflare",  slug: "cloudflare",   category: "Deploy", color: "F38020", blurb: "Workers, R2, D1" },
  { name: "Render",      slug: "render",       category: "Deploy", color: "46E3B7", blurb: "Zero-config hosting" },

  // Cloud
  { name: "AWS", slug: "amazonwebservices", category: "Cloud", color: "FF9900", blurb: "S3, Lambda, RDS" },

  // AI
  { name: "OpenAI",    slug: "openai",   category: "AI", color: "FFFFFF", blurb: "GPT, Realtime, embeddings" },
  { name: "Anthropic", slug: "anthropic", category: "AI", color: "D97757", blurb: "Claude models + MCP" },
  { name: "xAI",       slug: "x",         category: "AI", color: "FFFFFF", blurb: "Grok + tool use" },
  { name: "DeepSeek",  slug: "deepseek",  category: "AI", color: "4D6BFE", blurb: "Open-weight models" },

  // Analytics
  { name: "PostHog", slug: "posthog", category: "Analytics", color: "F54E00", blurb: "Product analytics + flags" },

  // Errors
  { name: "Sentry", slug: "sentry", category: "Errors", color: "362D59", blurb: "Error + performance tracking" },

  // Payments
  { name: "Stripe", slug: "stripe", category: "Payments", color: "635BFF", blurb: "Billing, subscriptions, tax" },

  // Code
  { name: "GitHub", slug: "github", category: "Code", color: "FFFFFF", blurb: "Repos, Actions, OAuth" },

  // Tickets
  { name: "Linear", slug: "linear", category: "Tickets", color: "5E6AD2", blurb: "Issues, projects, cycles" },

  // Email
  { name: "Resend", slug: "resend", category: "Email", color: "FFFFFF", blurb: "Transactional + React email" },

  // Auth
  { name: "Clerk", slug: "clerk", category: "Auth", color: "6C47FF", blurb: "Drop-in auth + users" },
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
