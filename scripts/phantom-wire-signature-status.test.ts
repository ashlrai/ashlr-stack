import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-signature-status.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");
const source = readFileSync(
  new URL("../packages/core/src/ai/phantom-wire.ts", import.meta.url),
  "utf8",
);

describe("Phantom wire signature status", () => {
  it("marks verification as a future step and keeps the example-scope claims aligned", async () => {
    const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
    if (!excerpt) throw new Error("Missing source excerpt");
    expect(doc).toContain("Status: not implemented");
    expect(doc).toContain("future step");
    expect(doc).toContain(".stack/webhooks/<provider>.ts");
    expect(doc).toContain("--no-wire");
    expect(excerpt).toContain("TODO(security): signature verification is NOT implemented here.");
    expect(source).toContain(excerpt.split("\n").slice(1).join("\n"));

    const links = [...doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
    expect(links).toContain("../packages/core/src/ai/phantom-wire.ts");
    for (const link of links) expect(existsSync(new URL(link, docUrl))).toBe(true);

    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "signature-status",
          query: "",
          createdAt: "",
          providers: [...providers, "vercel"].map((name) => ({ name })),
        },
        { cwd: harness.dir },
      );
      // Example scope: stubs only for the four webhook providers — a known
      // catalog provider like vercel gets inventoried but no webhook file.
      expect(result.webhooks).toHaveLength(providers.length);
      expect(result.skipped).toEqual([]);

      for (const [index, provider] of providers.entries()) {
        const path = result.webhooks[index];
        expect(path.endsWith(join(".stack", "webhooks", `${provider}.ts`))).toBe(true);
        const stub = readFileSync(path, "utf8");
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        expect(stub).toContain(excerpt);
        expect(stub.indexOf(excerpt)).toBeGreaterThan(stub.indexOf('req.headers.get("'));
        expect(stub.indexOf(excerpt)).toBeLessThan(stub.indexOf('return new Response("ok"'));

        const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
        const secret = stub.match(/phantom reveal ([A-Z_]+)/)?.[1];
        expect(header).toBeDefined();
        expect(secret).toBeDefined();
        const row = doc.split("\n").find((line) => line.toLowerCase().startsWith(`| ${provider} |`));
        expect(row).toContain(`\`${header}\` | \`${secret}\``);
      }

      const noWire = await wirePhantomForRecipe(
        {
          id: "signature-status-nowire",
          query: "",
          createdAt: "",
          providers: providers.map((name) => ({ name })),
        },
        { cwd: harness.dir, noWire: true },
      );
      expect(noWire).toEqual({ present: [], missing: [], webhooks: [], skipped: [] });

      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });
});
