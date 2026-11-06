import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

const docUrl = new URL("../docs/phantom-wire-example-questions.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire example and verification questions", () => {
  it("matches the documented empty-vault result and generated excerpt", async () => {
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "example", query: "", createdAt: "", providers: [{ name: "stripe" }] },
        { cwd: harness.dir },
      );
      expect(result).toEqual({
        present: [],
        missing: ["stripe:STRIPE_SECRET_KEY"],
        skipped: [],
        webhooks: [join(harness.dir, ".stack/webhooks/stripe.ts")],
      });
      const stub = readFileSync(result.webhooks[0], "utf8");
      const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
      expect(excerpt).toBeDefined();
      expect(stub).toContain(excerpt ?? "");
      expect(stub.split("\n").every (line => !line || line.startsWith("//"))).toBe(true);
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  }, 30_000);

  it("separates the observed example from open questions and resolves its links", () => {
    const [observations, questions] = doc.split("## Unanswered verification questions\n");
    expect(observations).toContain("## What the example shows");
    expect(observations).toContain("not ready to deploy");
    expect(questions).toBeDefined();
    expect(questions.match(/^\s*- [\s\S]*?\?$/gm)?.length).toBeGreaterThanOrEqual(5);
    for (const [, link] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
      expect(existsSync(new URL(link, docUrl))).toBe(true);
    }
  });
});
