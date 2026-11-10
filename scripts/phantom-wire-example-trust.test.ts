import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe, webhookStubFor } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-example-trust.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");
const signatureWarning = "TODO(security): signature verification is NOT implemented here.";

function assertExampleWarning(provider: string, example: string): void {
  if (!example.includes(signatureWarning)) {
    throw new Error(`${provider} example is missing the signature-verification warning`);
  }
}

describe("Phantom wire example trust", () => {
  it("identifies an example missing its signature-verification warning", () => {
    expect(() => assertExampleWarning("stripe", "// export async function handler() {}"))
      .toThrow("stripe example is missing the signature-verification warning");
  });

  it("places the verification reminder before the success response in each stub", () => {
    for (const provider of ["stripe", "clerk", "supabase", "github"]) {
      const stub = webhookStubFor(provider);
      const reminder = stub.indexOf(signatureWarning);
      const success = stub.indexOf('return new Response("ok", { status: 200 })');
      expect(reminder, `${provider} stub is missing the verification reminder`).toBeGreaterThanOrEqual(0);
      expect(success, `${provider} stub is missing the success response`).toBeGreaterThanOrEqual(0);
      expect(reminder, `${provider} stub returns success before warning about verification`).toBeLessThan(success);
    }
  });

  it("describes the behavior of each generated example", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "trust", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      expect(doc).toContain("illustrative guidance, not implemented\nverification");
      expect(doc).toContain("any non-empty");
      expect(doc).toContain("Recipe manifests are also unsigned");
      expect(existsSync(new URL("../packages/core/src/ai/phantom-wire.ts", docUrl))).toBe(true);
      expect(doc).toContain("../packages/core/src/ai/phantom-wire.ts");

      const examples = providers.map((provider, index) => {
        const stub = readFileSync(result.webhooks[index], "utf8");
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        expect(stub).toContain(signatureWarning);
        const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
        const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        if (!header || !example) throw new Error(`Incomplete ${provider} example`);
        assertExampleWarning(provider, example);
        const path = join(harness.dir, `${provider}-trust-example.ts`);
        writeFileSync(path, example.replace(/^\/\/ ?/gm, ""));
        return { provider, header, path };
      });
      for (const { provider, header, path } of examples) {
        const exports = await import(path);
        const handler = exports[`handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`];
        expect(typeof handler).toBe("function");
        const missing = new Request("https://example.com", { method: "POST", body: "payload" });
        expect((await handler(missing)).status).toBe(400);
        expect(missing.bodyUsed).toBe(false);
        for (const body of ["payload", "altered"]) {
          const request = new Request("https://example.com", {
            method: "POST",
            headers: { [header]: "forged" },
            body,
          });
          expect((await handler(request)).status).toBe(200);
        }
      }
      expect(harness.callsTo("reveal")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });
});
