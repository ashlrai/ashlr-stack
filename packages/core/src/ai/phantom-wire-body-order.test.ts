import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("webhook stub request body", () => {
  for (const provider of ["stripe", "clerk", "supabase", "github", "other"]) {
    it(`reads the ${provider} request body before the verification TODO`, () => {
      const stub = webhookStubFor(provider);
      const bodyRead = "//   const body = await req.text();";
      const verificationTodo =
        "//   // TODO(security): signature verification is NOT implemented here.";

      expect(stub.split(bodyRead)).toHaveLength(2);
      expect(stub).toContain(`${bodyRead}\n${verificationTodo}`);
    });
  }
});
