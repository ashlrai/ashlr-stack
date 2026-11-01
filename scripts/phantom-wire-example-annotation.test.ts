import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

describe("Phantom wire example annotation", () => {
  it("quotes the generated example and describes its unimplemented verification", async () => {
    const docUrl = new URL("../docs/phantom-wire-example-annotation.md", import.meta.url);
    const doc = readFileSync(docUrl, "utf8");
    const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
    expect(excerpt).toBeDefined();
    if (!excerpt) throw new Error("Missing annotated example");

    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "annotation", query: "", createdAt: "", providers: [{ name: "stripe" }] },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(1);
      const stub = readFileSync(result.webhooks[0], "utf8");
      expect(stub).toContain(excerpt);
      expect(excerpt.split("\n").every((line) => line.startsWith("//"))).toBe(true);
      expect(doc).toContain("illustrative");
      expect(doc).toContain("signature verification is NOT implemented here.");
      expect(doc).toContain("not executable verification");
      expect(doc).toContain("Any non-empty header passes");
      expect(doc).toContain("attacker-controlled");
      expect(harness.callsTo("reveal")).toEqual([]);
      for (const [, link] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        expect(existsSync(new URL(link, docUrl))).toBe(true);
      }
    } finally {
      harness.cleanup();
    }
  });
});
