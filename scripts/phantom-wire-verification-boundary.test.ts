import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

describe("Phantom wire verification boundary", () => {
  it("matches each generated placeholder and the behavior of the uncommented example", async () => {
    const docUrl = new URL("../docs/phantom-wire-verification-boundary.md", import.meta.url);
    const doc = readFileSync(docUrl, "utf8");
    const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
    if (!excerpt) throw new Error("Missing verification placeholder excerpt");
    expect(doc).toContain("The example itself does not implement signature verification.");
    expect(doc).toContain("attacker-controlled input");
    for (const [, link] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
      expect(existsSync(new URL(link, docUrl))).toBe(true);
    }

    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "verification-boundary",
          query: "",
          createdAt: "",
          providers: providers.map((name) => ({ name })),
        },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      const examples: Array<{ provider: string; header: string; path: string }> = [];
      for (const [index, path] of result.webhooks.entries()) {
        const stub = readFileSync(path, "utf8");
        expect(stub).toContain(excerpt);
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
        const example = stub.match(/^\/\/ export async function [\s\S]*?^\/\/ }$/m)?.[0];
        if (!header || !example) throw new Error(`Missing ${providers[index]} handler or header`);
        const examplePath = join(harness.dir, `${providers[index]}-verification-boundary.ts`);
        writeFileSync(examplePath, example.replace(/^\/\/ ?/gm, ""));
        examples.push({ provider: providers[index], header, path: examplePath });
      }
      for (const { provider, header, path } of examples) {
        const name = `handle${provider[0].toUpperCase()}${provider.slice(1)}Webhook`;
        const handler: unknown = (await import(path))[name];
        if (typeof handler !== "function") throw new Error(`Missing ${name}`);
        expect((await handler(new Request("https://example.com", { method: "POST" }))).status).toBe(
          400,
        );
        for (const body of ["original", "modified"]) {
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
