import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("webhook example verification warning", () => {
  for (const provider of ["stripe", "clerk", "supabase", "github", "unknown"]) {
    it(`places the introductory warning before the ${provider} handler`, () => {
      const output = webhookStubFor(provider);
      const warning = output.indexOf(
        "This entire example is commented out and does not verify signatures.",
      );
      const handler = output.indexOf("// export async function handle");

      expect(warning).toBeGreaterThanOrEqual(0);
      expect(handler).toBeGreaterThan(warning);
    });
  }

  for (const provider of ["stripe", "clerk", "supabase", "github", "unknown"]) {
    it(`places the complete warning between the body read and placeholder response for ${provider}`, () => {
      const lines = webhookStubFor(provider).split("\n");
      const bodyRead = lines.indexOf("//   const body = await req.text();");
      const warning = lines.indexOf(
        "//   // TODO(security): signature verification is NOT implemented here. The",
      );
      const warningEnd = lines.indexOf("//   // parse, trust, or act on the body.");
      const response = lines.indexOf('//   return new Response("ok", { status: 200 });');

      expect(bodyRead).toBeGreaterThanOrEqual(0);
      expect(warning).toBeGreaterThan(bodyRead);
      expect(warningEnd).toBeGreaterThan(warning);
      expect(response).toBeGreaterThan(warningEnd);
    });
  }
});
