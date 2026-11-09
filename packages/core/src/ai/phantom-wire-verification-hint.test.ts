import { describe, expect, test } from "bun:test";
import { verificationHintFor } from "./phantom-wire.ts";

describe("verificationHintFor", () => {
  test.each([
    ["stripe", "Stripe: `stripe.webhooks.constructEvent` — HMAC-SHA256 with timestamp tolerance."],
    ["clerk", "Clerk (svix): `new Webhook(secret).verify(body, headers)`."],
    ["supabase", "Supabase: `x-supabase-signature` per Supabase's documented webhook scheme."],
    ["github", "GitHub: `x-hub-signature-256` is `sha256=` + HMAC-SHA256 of the raw body."],
  ])("returns provider-specific guidance for %s", (provider, guidance) => {
    expect(verificationHintFor(provider)).toBe(guidance);
  });

  test("returns generic guidance for an unknown provider", () => {
    expect(verificationHintFor("unknown")).toBe(
      "Verify per the provider's documented signature scheme.",
    );
  });
});
