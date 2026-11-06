import { describe, expect, it } from "bun:test";
import { webhookStubFor } from "./phantom-wire.ts";

describe("ai/phantom-wire single quotes in replacement text", () => {
  it.each(["pay'hook", "'hook", "hook'", "'", "a''b", "svc$'pay"])(
    "preserves quotes at every expansion site for %j",
    (name) => {
      const stub = webhookStubFor(name);
      // A sentinel render provides a whole-output oracle without treating $'
      // as a String.replace replacement directive.
      const sentinel = name.replaceAll("'", "\u0000");
      const expected = webhookStubFor(sentinel).replaceAll("\u0000", () => "'");

      expect(stub).toBe(expected);
      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${name[0].toUpperCase()}${name.slice(1)}Webhook`);
      expect(stub.split(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);
      expect(stub.split("'").length - 1).toBe((name.split("'").length - 1) * 5 + 1);
    },
  );
});
