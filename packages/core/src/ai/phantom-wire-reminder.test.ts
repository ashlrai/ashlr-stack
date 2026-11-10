import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("generated webhook verification reminder", () => {
  it.each([
    ["stripe", "stripe.webhooks.constructEvent"],
    ["clerk", "new Webhook(secret).verify(body, headers)"],
    ["supabase", "Supabase's documented webhook scheme"],
    ["github", "x-hub-signature-256"],
    ["other", "provider's documented signature scheme"],
  ])("tells the reader how to begin verification for %s", (provider, hint) => {
    const stub = webhookStubFor(provider);

    expect(stub).toContain("Implement verification first");
    expect(stub).toContain("signature verification is NOT implemented here");
    expect(stub).toContain(hint);
    expect(stub).toContain("reject missing or invalid signatures");
  });
});
