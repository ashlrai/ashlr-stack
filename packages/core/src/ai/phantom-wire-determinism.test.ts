import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("webhook example determinism", () => {
  for (const provider of ["stripe", "clerk", "supabase", "github", "other", "pay${provider}"]) {
    it(`generates the same complete example repeatedly for ${provider}`, () => {
      const expected = webhookStubFor(provider);
      expect(expected).toContain(`webhook handler stub for ${provider}.`);

      for (let attempt = 0; attempt < 10; attempt++) {
        // Interleave another provider to catch state leaking between renders.
        webhookStubFor(provider === "stripe" ? "github" : "stripe");
        expect(webhookStubFor(provider)).toBe(expected);
      }
    });
  }
});
