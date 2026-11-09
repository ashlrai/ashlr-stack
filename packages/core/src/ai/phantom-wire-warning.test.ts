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
      const lines = example.split("\n");
      const handler = lines.findIndex((line) => line.startsWith("// export async function handle"));
      const success = lines.findIndex((line) => line.includes('return new Response("ok"'));
      const warning = lines.findIndex((line) => line.includes("does not verify signatures"));
      expect(warning).toBeGreaterThanOrEqual(0);
      expect(handler).toBeGreaterThan(warning);
      for (const text of [
        "If uncommented as-is, it accepts any non-empty signature header and returns",
        "200 without authenticating the request. Implement verification first.",
      ]) {
        const warningLine = lines.findIndex((line) => line.includes(text));
        expect(warningLine).toBeGreaterThan(warning);
        expect(warningLine).toBeLessThan(handler);
      }
      expect(success).toBeGreaterThan(handler);
      expect(lines[success]).toMatch(/^\/\/\s+return new Response/);
      expect(lines.every((line) => line.trim() === "" || line.startsWith("//"))).toBe(true);
    });
  }
});
