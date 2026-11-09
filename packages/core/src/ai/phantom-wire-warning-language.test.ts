import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("webhook signature warning language", () => {
  for (const provider of ["stripe", "clerk", "supabase", "github", "other"]) {
    it(`explains the missing verification and its consequences for ${provider}`, () => {
      const stub = webhookStubFor(provider);
      const warning = stub.slice(stub.indexOf("TODO(security)"), stub.indexOf("//   return"));

      expect(warning).toContain("signature verification is NOT implemented here");
      expect(warning).toContain("header check above proves only that a signature header arrived");
      expect(warning).toContain("value is never compared to anything");
      expect(warning).toContain("is unauthenticated, attacker-controlled input");
      expect(warning).toContain(`to this endpoint can forge a ${provider} webhook`);
    });
  }
});
