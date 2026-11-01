import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-example-trust.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire example trust", () => {
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
        expect(stub).toContain("TODO(security): signature verification is NOT implemented here.");
        const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
        const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        if (!header || !example) throw new Error(`Incomplete ${provider} example`);
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
