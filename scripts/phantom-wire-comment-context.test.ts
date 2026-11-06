import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-comment-context.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire verification comment context", () => {
  it("describes the TODO in each generated, entirely commented handler", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "comment-context", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      for (const path of result.webhooks) {
        const stub = readFileSync(path, "utf8");
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        const handler = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        expect(handler).toBeDefined();
        if (!handler) throw new Error(`Missing handler in ${path}`);
        const body = handler.indexOf("const body = await req.text();");
        const todo = handler.indexOf("TODO(security): signature verification is NOT implemented here.");
        const success = handler.indexOf('return new Response("ok", { status: 200 })');
        expect(body).toBeGreaterThanOrEqual(0);
        expect(todo).toBeGreaterThan(body);
        expect(success).toBeGreaterThan(todo);
      }
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(doc).toContain("Every\nline of the generated example is commented out.");
      expect(doc).toContain("the TODO remains a comment");
      expect(doc).toContain("any non-empty header reaches the 200");
      expect(doc).toContain("Recipe manifests have a\nseparate limitation: they are unsigned");
      for (const [, link] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        expect(existsSync(new URL(link, docUrl))).toBe(true);
      }
    } finally {
      harness.cleanup();
    }
  });
});
