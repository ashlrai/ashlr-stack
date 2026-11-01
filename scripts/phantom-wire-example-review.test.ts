import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

const docUrl = new URL("../docs/phantom-wire-example-review.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire example review", () => {
  it("grounds its questions in the generated Stripe example", async () => {
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "example-review", query: "", createdAt: "", providers: [{ name: "stripe" }] },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(1);
      const stub = readFileSync(result.webhooks[0], "utf8");
      expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
      for (const source of [
        'req.headers.get("stripe-signature")',
        'new Response("Missing signature", { status: 400 })',
        "await req.text()",
        "TODO(security): signature verification is NOT implemented here.",
        'new Response("ok", { status: 200 })',
      ]) {
        expect(stub).toContain(source);
      }
      for (const statement of [
        "`Request`",
        "`stripe-signature`",
        "any non-empty header",
        "attacker-controlled input",
        "not a production-ready handler",
        "`TODO(security)`",
      ]) {
        expect(doc).toContain(statement);
      }
      for (const heading of ["Input and claimed boundary", "Unfinished verification"]) {
        const section = doc.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
        expect(section).toBeDefined();
        expect(section?.match(/^- [\s\S]*?\?$/gm)?.length).toBeGreaterThanOrEqual(3);
      }
      expect(harness.callsTo("reveal")).toEqual([]);
      for (const [, link] of doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        expect(existsSync(new URL(link, docUrl))).toBe(true);
      }
    } finally {
      harness.cleanup();
    }
  }, 30_000);
});
