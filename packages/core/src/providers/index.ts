import type { Provider } from "./_base.ts";
import { ProviderNotFoundError } from "../errors.ts";

/**
 * Registry of curated providers. Entries are added in Waves 2–3 as each
 * provider is implemented. Keeping this list explicit (no dynamic discovery)
 * keeps the catalog curated and the bundle small.
 */

const registry: Record<string, () => Promise<Provider>> = {
  // Wave 2 pilot — full upstream lifecycle via Management API.
  supabase: async () => (await import("./supabase.ts")).default,

  // Wave 3 — databases & deploy.
  neon: async () => (await import("./neon.ts")).default,
  turso: async () => (await import("./turso.ts")).default,
  convex: async () => (await import("./convex.ts")).default,
  vercel: async () => (await import("./vercel.ts")).default,
  railway: async () => (await import("./railway.ts")).default,
  fly: async () => (await import("./fly.ts")).default,
  cloudflare: async () => (await import("./cloudflare.ts")).default,
  render: async () => (await import("./render.ts")).default,
  firebase: async () => (await import("./firebase.ts")).default,
  upstash: async () => (await import("./upstash.ts")).default,

  // Wave 3 — AI API keys (no upstream provisioning; paste + verify).
  openai: async () => (await import("./openai.ts")).default,
  anthropic: async () => (await import("./anthropic.ts")).default,
  xai: async () => (await import("./xai.ts")).default,
  deepseek: async () => (await import("./deepseek.ts")).default,
  replicate: async () => (await import("./replicate.ts")).default,
  braintrust: async () => (await import("./braintrust.ts")).default,
  modal: async () => (await import("./modal.ts")).default,

  // Wave 3 — analytics / errors / code / ops.
  posthog: async () => (await import("./posthog.ts")).default,
  sentry: async () => (await import("./sentry.ts")).default,
  github: async () => (await import("./github.ts")).default,
  linear: async () => (await import("./linear.ts")).default,
  stripe: async () => (await import("./stripe.ts")).default,
  resend: async () => (await import("./resend.ts")).default,
  clerk: async () => (await import("./clerk.ts")).default,
  aws: async () => (await import("./aws.ts")).default,
};

export const providers = registry;

export function listProviderNames(): string[] {
  return Object.keys(registry).sort();
}

export async function getProvider(name: string): Promise<Provider> {
  const loader = registry[name];
  if (!loader) throw new ProviderNotFoundError(name);
  return loader();
}
