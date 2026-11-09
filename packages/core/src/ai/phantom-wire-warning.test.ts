import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("generated webhook examples", () => {
  for (const [provider, header] of [
    ["stripe", "stripe-signature"],
    ["clerk", "svix-signature"],
    ["supabase", "x-supabase-signature"],
    ["github", "x-hub-signature-256"],
    ["other", "x-webhook-signature"],
  ]) {
    it(`${provider} warns that the example does not authenticate requests`, () => {
      const example = webhookStubFor(provider);
      expect(example).toContain(
        "This entire example is commented out and does not verify signatures.",
      );
      expect(example).toContain("signature verification is NOT implemented here");
      expect(example).toContain(
        "200 without authenticating the request. Implement verification first.",
      );
      expect(example).toContain(`req.headers.get("${header}")`);
      expect(example).toContain(`to this endpoint can forge a ${provider} webhook.`);
      expect(example.split("\n").every((line) => line === "" || line.startsWith("//"))).toBe(true);
    });
  }
});
