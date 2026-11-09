import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("webhook example repeat generation", () => {
  it("produces identical text for identical providers across interleaved calls", () => {
    const providers = ["stripe", "clerk", "supabase", "github", "custom-provider"];
    const examples = providers.map((provider) => webhookStubFor(provider));

    for (const [index, provider] of providers.entries()) {
      expect(examples[index]).toContain(`webhook handler stub for ${provider}.`);
      expect(webhookStubFor(provider)).toBe(examples[index]);
    }

    // Repeat in reverse order to expose state carried over from another provider.
    for (let index = providers.length - 1; index >= 0; index--) {
      expect(webhookStubFor(providers[index])).toBe(examples[index]);
    }
  });
});
