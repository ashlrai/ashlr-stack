import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-example-caveats.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire example caveats", () => {
  it("keeps the caveats and provider table aligned with the generated examples", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "caveats", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      expect(doc).toContain("signature verification is NOT implemented here.");
      expect(doc).toContain("any non-empty value");
      expect(doc).toContain("Recipe manifests have a separate limitation: they are unsigned");

      for (const [index, provider] of providers.entries()) {
        const stub = readFileSync(result.webhooks[index], "utf8");
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        expect(stub).toContain("TODO(security): signature verification is NOT implemented here.");
        const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
        const secret = stub.match(/phantom reveal ([A-Z_]+)/)?.[1];
        expect(header).toBeDefined();
        expect(secret).toBeDefined();
        const row = doc.split("\n").find((line) => line.toLowerCase().startsWith(`| ${provider} |`));
        expect(row).toContain(`\`${header}\` | \`${secret}\``);
      }
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
