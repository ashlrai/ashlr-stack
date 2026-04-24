/**
 * Swap-pair registry for `stack swap <from> <to>`.
 *
 * A SwapPair declares that two providers are functionally equivalent and can be
 * swapped. Optional `aliases` preserve env-key compat so consuming code doesn't
 * need to change after the swap (e.g. if the old provider wrote SUPABASE_URL but
 * the new one writes DATABASE_URL, alias DATABASE_URL → SUPABASE_URL so both
 * names exist in Phantom during the transition).
 *
 * Aliases are one-directional: they apply only when `from` is the source side.
 * To support bidirectional swaps, add both directions explicitly.
 */

export interface SwapPair {
  from: string;
  to: string;
  /**
   * Env-key aliases created after provisioning `to`.
   * Key = the NEW provider's env key, Value = the OLD provider's env key to
   * mirror it under, so downstream code referencing the old key still works.
   *
   * Example: { DATABASE_URL: "SUPABASE_URL" } means after swapping supabase → neon,
   * the neon DATABASE_URL value is ALSO written to SUPABASE_URL in Phantom.
   */
  aliases?: Record<string, string>;
}

export const SWAP_PAIRS: SwapPair[] = [
  // ── Auth ──────────────────────────────────────────────────────────────────
  { from: "clerk", to: "auth0" },
  { from: "auth0", to: "clerk" },
  { from: "clerk", to: "workos" },
  { from: "workos", to: "clerk" },
  { from: "auth0", to: "workos" },
  { from: "workos", to: "auth0" },

  // ── Database ──────────────────────────────────────────────────────────────
  // supabase uses SUPABASE_URL; neon uses DATABASE_URL — alias so existing
  // SUPABASE_URL references resolve after moving to neon.
  {
    from: "supabase",
    to: "neon",
    aliases: { DATABASE_URL: "SUPABASE_URL" },
  },
  {
    from: "neon",
    to: "supabase",
    aliases: {
      SUPABASE_URL: "DATABASE_URL",
      SUPABASE_ANON_KEY: "DATABASE_URL", // best-effort compat; user should update code
    },
  },

  // ── Email ─────────────────────────────────────────────────────────────────
  { from: "resend", to: "sendgrid" },
  { from: "sendgrid", to: "resend" },
  { from: "resend", to: "mailgun" },
  { from: "mailgun", to: "resend" },
  { from: "resend", to: "postmark" },
  { from: "postmark", to: "resend" },
  { from: "sendgrid", to: "mailgun" },
  { from: "mailgun", to: "sendgrid" },
  { from: "sendgrid", to: "postmark" },
  { from: "postmark", to: "sendgrid" },
  { from: "mailgun", to: "postmark" },
  { from: "postmark", to: "mailgun" },

  // ── Analytics ─────────────────────────────────────────────────────────────
  { from: "posthog", to: "mixpanel" },
  { from: "mixpanel", to: "posthog" },
  { from: "posthog", to: "plausible" },
  { from: "plausible", to: "posthog" },
  { from: "mixpanel", to: "plausible" },
  { from: "plausible", to: "mixpanel" },

  // ── Observability ─────────────────────────────────────────────────────────
  { from: "datadog", to: "grafana" },
  { from: "grafana", to: "datadog" },

  // ── Deploy ────────────────────────────────────────────────────────────────
  { from: "vercel", to: "railway" },
  { from: "railway", to: "vercel" },
  { from: "vercel", to: "fly" },
  { from: "fly", to: "vercel" },
  { from: "vercel", to: "render" },
  { from: "render", to: "vercel" },
  { from: "railway", to: "fly" },
  { from: "fly", to: "railway" },
  { from: "railway", to: "render" },
  { from: "render", to: "railway" },
  { from: "fly", to: "render" },
  { from: "render", to: "fly" },
];

/**
 * Find the registered swap pair for `from` → `to`, if one exists.
 */
export function findSwap(from: string, to: string): SwapPair | undefined {
  return SWAP_PAIRS.find((p) => p.from === from && p.to === to);
}

/**
 * Return all known `to` candidates for a given `from` provider.
 * Useful for suggestions when no exact pair is found.
 */
export function suggestSwaps(from: string): string[] {
  return SWAP_PAIRS.filter((p) => p.from === from).map((p) => p.to);
}
