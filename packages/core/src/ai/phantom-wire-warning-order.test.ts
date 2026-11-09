import { describe, expect, it } from "bun:test";
import { verificationHintFor, webhookStubFor } from "./phantom-wire.ts";

const PROVIDERS = ["stripe", "clerk", "supabase", "github", "unknown"];

describe("webhook example warning order", () => {
  for (const provider of PROVIDERS) {
    it(`${provider}: warning follows the body read and precedes the placeholder handling`, () => {
      const lines = webhookStubFor(provider).split("\n");
      const bodyRead = lines.indexOf("//   const body = await req.text();");
      const warning = lines.findIndex((line) =>
        line.includes("signature verification is NOT implemented here"),
      );
      // Placeholder handling: the provider hint and the `phantom reveal`
      // secret retrieval that the implementer must fill in.
      const hint = lines.indexOf(`//   // ${verificationHintFor(provider)}`);
      const reveal = lines.findIndex(
        (line, i) => i > warning && line.includes("`phantom reveal ") && line.includes("compare in"),
      );
      const response = lines.indexOf('//   return new Response("ok", { status: 200 });');

      expect(bodyRead).toBeGreaterThanOrEqual(0);
      expect(warning).toBe(bodyRead + 1);
      expect(hint).toBeGreaterThan(warning);
      expect(reveal).toBeGreaterThan(hint);
      expect(response).toBeGreaterThan(reveal);
    });
  }
});
