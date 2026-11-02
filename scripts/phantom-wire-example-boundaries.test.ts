import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-example-boundaries.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire example boundaries", () => {
  it("distinguishes shown operations from the verification TODO, matching generated stubs", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "example-boundaries",
          query: "",
          createdAt: "",
          providers: providers.map((name) => ({ name })),
        },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);

      // The doc's excerpt is verbatim from the generated Stripe stub and is
      // entirely comments — shown operations, not running code.
      const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
      expect(excerpt).toBeDefined();
      if (!excerpt) throw new Error("Missing documented example excerpt");
      const stripe = readFileSync(result.webhooks[0], "utf8");
      expect(stripe).toContain(excerpt);
      expect(excerpt.split("\n").every((line) => line.startsWith("//"))).toBe(true);

      for (const path of result.webhooks) {
        const stub = readFileSync(path, "utf8");
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
      }

      // The shown operations the doc names exist in the generated example;
      // the verification step is named only as a TODO.
      for (const shown of [
        'req.headers.get("stripe-signature")',
        "Missing signature",
        "await req.text()",
        'return new Response("ok", { status: 200 })',
      ]) {
        expect(doc).toContain(shown);
        expect(stripe).toContain(shown);
      }
      expect(doc).toContain("TODO(security): signature verification is NOT implemented here.");
      expect(doc).toContain("attacker-controlled");
      expect(stripe).toContain("TODO(security): signature verification is NOT implemented here.");

      // The doc's source citations name real identifiers in the module, so a
      // rename there is caught here as doc drift.
      const src = readFileSync(
        new URL("../packages/core/src/ai/phantom-wire.ts", import.meta.url),
        "utf8",
      );
      for (const cited of [
        "webhookStubFor",
        "writeWebhookStub",
        "wirePhantomForRecipe",
        "listVaultNames",
        "findProviderRef",
        "signatureHeaderFor",
        "webhookSecretKeyFor",
        "verificationHintFor",
      ]) {
        expect(doc).toContain(`\`${cited}\``);
        expect(src).toContain(cited);
      }

      // Behavior on each side of the boundary, proven by running the
      // uncommented example: missing header → 400 before the body is read;
      // any non-empty value → 200 (nothing is verified).
      const example = stripe.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
      if (!example) throw new Error("Missing Stripe handler");
      const path = join(harness.dir, "stripe-boundaries-example.ts");
      writeFileSync(path, example.replace(/^\/\/ ?/gm, ""));
      const handler: unknown = (await import(path)).handleStripeWebhook;
      if (typeof handler !== "function") throw new Error("Missing Stripe handler");

      const unsigned = new Request("https://example.com", { method: "POST", body: "payload" });
      expect((await handler(unsigned)).status).toBe(400);
      expect(unsigned.bodyUsed).toBe(false);
      const forged = new Request("https://example.com", {
        method: "POST",
        headers: { "stripe-signature": "forged" },
        body: "payload",
      });
      expect((await handler(forged)).status).toBe(200);
      expect(forged.bodyUsed).toBe(true);

      // No secret retrieval or vault write happened anywhere in wiring.
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);

      for (const [, link] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        expect(existsSync(new URL(link, docUrl))).toBe(true);
      }
    } finally {
      harness.cleanup();
    }
  });
});
