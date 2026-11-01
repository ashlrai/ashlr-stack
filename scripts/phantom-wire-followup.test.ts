import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

const docUrl = new URL("../docs/phantom-wire-followup.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire signature follow-up", () => {
  it("keeps the unresolved source-context excerpt aligned with generated examples", async () => {
    const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
    if (!excerpt) throw new Error("Missing source-context excerpt");
    expect(doc).toContain("Status: unresolved");
    expect(doc).toContain("source context");
    expect(excerpt).toContain("TODO(security): signature verification is NOT implemented here.");

    const links = [...doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
    expect(links).toContain("../packages/core/src/ai/phantom-wire.ts");
    for (const link of links) expect(existsSync(new URL(link, docUrl))).toBe(true);

    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "followup", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      for (const [index, path] of result.webhooks.entries()) {
        expect(doc).toContain(`\`${providers[index]}\``);
        const stub = readFileSync(path, "utf8");
        expect(stub).toContain(excerpt);
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        expect(stub.indexOf(excerpt)).toBeLessThan(stub.indexOf('return new Response("ok"'));
      }
      expect(harness.callsTo("reveal")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });
});
