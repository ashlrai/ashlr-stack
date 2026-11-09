import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("webhook example verification warning", () => {
  for (const provider of ["stripe", "github", "unknown"]) {
    it(`places the warning between the body read and response for ${provider}`, () => {
      const lines = webhookStubFor(provider).split("\n");
      const bodyRead = lines.indexOf("//   const body = await req.text();");
      const warning = lines.indexOf(
        "//   // TODO(security): signature verification is NOT implemented here. The",
      );
      const response = lines.indexOf('//   return new Response("ok", { status: 200 });');

      expect(bodyRead).toBeGreaterThanOrEqual(0);
      expect(warning).toBeGreaterThan(bodyRead);
      expect(response).toBeGreaterThan(warning);
      expect(lines.slice(warning, response).join("\n")).toContain(
        "//   // parse, trust, or act on the body.",
      );
    });
  }
});
