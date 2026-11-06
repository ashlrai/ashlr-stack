import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

const docUrl = new URL("../docs/phantom-wire-signature-note.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");
const source = readFileSync(
  new URL("../packages/core/src/ai/phantom-wire.ts", import.meta.url),
  "utf8",
);

describe("Phantom wire signature note", () => {
  it("labels the signature-verification TODO as a future concern and stays aligned", async () => {
    const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
    if (!excerpt) throw new Error("Missing TODO excerpt");
    expect(doc).toContain("future concern");
    expect(doc).toContain("TODO(security)");
    expect(excerpt).toContain("TODO(security): signature verification is NOT implemented here.");
    expect(source).toContain(excerpt.split("\n").slice(1).join("\n"));

    const links = [...doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
    expect(links).toContain("../packages/core/src/ai/phantom-wire.ts");
    for (const link of links) expect(existsSync(new URL(link, docUrl))).toBe(true);

    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "signature-note", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      for (const path of result.webhooks) {
        const stub = readFileSync(path, "utf8");
        expect(stub).toContain(excerpt);
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        expect(stub.indexOf(excerpt)).toBeGreaterThan(stub.indexOf('req.headers.get("'));
        expect(stub.indexOf(excerpt)).toBeLessThan(stub.indexOf('return new Response("ok"'));
      }
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });
});
