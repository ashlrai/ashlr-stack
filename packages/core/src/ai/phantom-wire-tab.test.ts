import { describe, expect, it } from "bun:test";
import { verificationHintFor, webhookStubFor } from "./phantom-wire.ts";

const tabCount = (s: string) => s.split("\t").length - 1;

describe("ai/phantom-wire replacement text containing a tab", () => {
  it("preserves the literal tab byte at all five expansion sites", () => {
    const stub = webhookStubFor("a\tb");
    const flat = webhookStubFor("ab");

    expect(stub).toContain("webhook handler stub for a\tb.");
    expect(stub).toContain("forge a a\tb webhook.");
    expect(stub).toContain("handleA\tbWebhook(req: Request)");
    expect(stub.split("phantom reveal A\tB_WEBHOOK_SECRET").length - 1).toBe(2);

    // Exactly one tab per site over the flat render; none expanded or escaped.
    expect(tabCount(stub)).toBe(tabCount(flat) + 5);
    expect(stub.charCodeAt(stub.indexOf("stub for a") + "stub for a".length)).toBe(0x09);
    expect(stub).not.toContain("\\t");
    expect(stub).not.toContain("${");

    // Other slots are unaffected by the tab-bearing name.
    expect(stub).toContain('req.headers.get("x-webhook-signature")');
    expect(verificationHintFor("a\tb")).toBe(verificationHintFor("zzq"));
  });

  it.each(["\tx", "x\t", "a\tb\tc", "\t", "a\t\tb"])(
    "keeps every literal tab in %j at all five expansion sites",
    (name) => {
      const stub = webhookStubFor(name);
      const flat = webhookStubFor(name.replace(/\t/g, ""));
      const capitalized = `${name[0].toUpperCase()}${name.slice(1)}`;

      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(stub).toContain(`handle${capitalized}Webhook(req: Request)`);
      expect(stub.split(`phantom reveal ${name.toUpperCase()}_WEBHOOK_SECRET`).length - 1).toBe(2);
      expect(tabCount(stub)).toBe(tabCount(flat) + 5 * tabCount(name));
      expect(stub).not.toContain("\\t");
    },
  );
});
