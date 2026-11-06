import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-example-boundary.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire example boundary", () => {
  it("matches the excerpt and described behavior of generated examples", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "example-boundary",
          query: "",
          createdAt: "",
          providers: providers.map((name) => ({ name })),
        },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
      expect(excerpt).toBeDefined();
      if (!excerpt) throw new Error("Missing documented example excerpt");
      expect(readFileSync(result.webhooks[0], "utf8")).toContain(excerpt);
      expect(doc).toContain("TODO in an example");
      expect(doc).toContain("attacker-controlled");

      for (const path of result.webhooks) {
        const stub = readFileSync(path, "utf8");
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
      }
      const stripe = readFileSync(result.webhooks[0], "utf8");
      const example = stripe.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
      if (!example) throw new Error("Missing Stripe handler");
      const path = join(harness.dir, "stripe-boundary-example.ts");
      writeFileSync(path, example.replace(/^\/\/ ?/gm, ""));
      const handler: unknown = (await import(path)).handleStripeWebhook;
      if (typeof handler !== "function") throw new Error("Missing Stripe handler");

      const unsigned = new Request("https://example.com", { method: "POST", body: "original" });
      expect((await handler(unsigned)).status).toBe(400);
      expect(unsigned.bodyUsed).toBe(false);
      for (const body of ["original", "modified"]) {
        const request = new Request("https://example.com", {
          method: "POST",
          headers: { "stripe-signature": "forged" },
          body,
        });
        expect((await handler(request)).status).toBe(200);
        expect(request.bodyUsed).toBe(true);
      }
      expect(harness.callsTo("reveal")).toEqual([]);
      for (const [, link] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        expect(existsSync(new URL(link, docUrl))).toBe(true);
      }
    } finally {
      harness.cleanup();
    }
  });
});
