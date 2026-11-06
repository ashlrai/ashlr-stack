import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-example-annotations.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");
const source = readFileSync(new URL("../packages/core/src/ai/phantom-wire.ts", import.meta.url), "utf8");

describe("Phantom wire example annotations", () => {
  it("links each annotation to the relevant source", () => {
    const sourceLines = source.split("\n");
    const links = [...doc.matchAll(/phantom-wire\.ts#L(\d+)/g)];
    const constructs = [
      "function webhookStubFor",
      "async function writeWebhookStub",
      "export async function handle",
      "TODO(security): signature verification is NOT implemented here.",
      "function verificationHintFor",
    ];
    expect(links).toHaveLength(constructs.length);
    links.forEach((link, index) =>
      expect(sourceLines[Number(link[1]) - 1]).toContain(constructs[index]),
    );
    for (const [, link] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
      expect(existsSync(new URL(link, docUrl))).toBe(true);
    }
    expect(doc).toContain("any non-empty signature header");
    expect(doc).toContain("signature verification is not\n  implemented");
    expect(doc).toContain("attacker-controlled");
  });

  it("matches the Stripe excerpt and the reminder in every generated stub", async () => {
    const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
    if (!excerpt) throw new Error("Missing generated example");
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "annotations", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toEqual(
        providers.map((provider) => join(harness.dir, ".stack", "webhooks", `${provider}.ts`)),
      );
      for (const [index, path] of result.webhooks.entries()) {
        const stub = readFileSync(path, "utf8");
        if (index === 0) expect(stub).toContain(excerpt);
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        const reminder = stub.indexOf("TODO(security): signature verification is NOT implemented here.");
        expect(reminder).toBeGreaterThan(stub.indexOf("req.text()"));
        expect(reminder).toBeLessThan(stub.indexOf('return new Response("ok"'));
        expect(stub).toContain(`to this endpoint can forge a ${providers[index]} webhook.`);
      }
      expect(harness.callsTo("reveal")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });
});
