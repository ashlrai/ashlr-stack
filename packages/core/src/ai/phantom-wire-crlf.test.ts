import { describe, expect, it } from "bun:test";
import { verificationHintFor, webhookStubFor } from "./phantom-wire.ts";

const crlfCount = (s: string) => s.split("\r\n").length - 1;

describe("ai/phantom-wire replacement text containing CRLF", () => {
  it("keeps the exact CRLF bytes at all five expansion sites", () => {
    // CR+LF in the name is data: it must come out as the two bytes 0x0D 0x0A
    // at every site, not normalized to LF, not split, not escaped.
    const stub = webhookStubFor("a\r\nb");
    const flat = webhookStubFor("ab");

    expect(stub).toContain("webhook handler stub for a\r\nb.");
    expect(stub).toContain("forge a a\r\nb webhook.");
    expect(stub).toContain("handleA\r\nbWebhook(req: Request)");
    expect(stub.split("phantom reveal A\r\nB_WEBHOOK_SECRET").length - 1).toBe(2);

    // Template is LF-only, so every CRLF in the output is one we inserted.
    expect(crlfCount(webhookStubFor("a\nb"))).toBe(0);
    expect(crlfCount(stub)).toBe(5);
    expect(stub.split("\r").length - 1).toBe(5);
    expect(stub.split("\n").length - 1).toBe(flat.split("\n").length - 1 + 5);
    expect(stub).not.toContain("\\r");
    expect(stub).not.toContain("\\n");
    expect(stub).not.toContain("${");

    // Byte-level pin right after the first site.
    const at = stub.indexOf("stub for a") + "stub for a".length;
    expect([stub.charCodeAt(at), stub.charCodeAt(at + 1)]).toEqual([0x0d, 0x0a]);

    expect(verificationHintFor("a\r\nb")).toBe(verificationHintFor("zzq"));
  });

  it.each(["\r\n", "x\r\n", "\r\nx", "a\r\n\r\nb", "a\n\rb"])(
    "preserves every CR and LF byte of %j in order",
    (name) => {
      const stub = webhookStubFor(name);
      const flat = webhookStubFor(name.replace(/[\r\n]/g, ""));
      const count = (s: string, ch: string) => s.split(ch).length - 1;

      expect(stub).toContain(`webhook handler stub for ${name}.`);
      expect(stub).toContain(`forge a ${name} webhook.`);
      expect(count(stub, "\r")).toBe(count(flat, "\r") + 5 * count(name, "\r"));
      expect(count(stub, "\n")).toBe(count(flat, "\n") + 5 * count(name, "\n"));
      expect(crlfCount(stub)).toBe(crlfCount(flat) + 5 * crlfCount(name));
    },
  );
});
