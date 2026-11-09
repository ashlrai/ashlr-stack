import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

const countOf = (text: string, needle: string): number => text.split(needle).length - 1;

describe("generated webhook example verification reminder", () => {
  for (const provider of ["stripe", "clerk", "supabase", "github", "other"]) {
    it(`${provider} example states each verification reminder exactly once`, () => {
      const example = webhookStubFor(provider);
      for (const reminder of [
        "does not verify signatures.",
        "Implement verification first.",
        "TODO(security): signature verification is NOT implemented here.",
      ]) {
        expect(countOf(example, reminder)).toBe(1);
      }
      expect(countOf(example, "TODO(security)")).toBe(1);
    });
  }
});
