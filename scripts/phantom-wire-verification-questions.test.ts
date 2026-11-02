import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

setDefaultTimeout(30_000);

const docUrl = new URL("../docs/phantom-wire-verification-questions.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");
const source = readFileSync(
  new URL("../packages/core/src/ai/phantom-wire.ts", import.meta.url),
  "utf8",
);

describe("Phantom wire verification questions", () => {
  it("quotes the generated example's verification TODO verbatim and asks only unanswered questions", async () => {
    // The excerpt must be a verbatim slice of every generated example so the
    // doc identifies the TODO as emitted, not paraphrased.
    const excerpt = doc.match(/```ts\n([\s\S]*?)\n```/)?.[1];
    expect(excerpt).toBeDefined();
    expect(excerpt).toContain("TODO(security): signature verification is NOT implemented here.");
    expect(source).toContain(excerpt ?? "");

    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        {
          id: "verification-questions",
          query: "",
          createdAt: "",
          providers: providers.map((name) => ({ name })),
        },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);

      for (const [index, provider] of providers.entries()) {
        const stub = readFileSync(result.webhooks[index], "utf8");
        // Every generated line is comment text — nothing verifies a request.
        expect(stub.split("\n").every((line) => !line || line.startsWith("//"))).toBe(true);
        expect(stub).toContain(excerpt ?? "");
        // The TODO sits between the body read and the success response.
        const todo = stub.indexOf("TODO(security)");
        expect(todo).toBeGreaterThan(stub.indexOf("await req.text()"));
        expect(todo).toBeLessThan(stub.indexOf('return new Response("ok"'));

        // Each provider table row names what that generated example names and
        // leaves the integration question open.
        const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
        const secret = stub.match(/phantom reveal ([A-Z_]+)/)?.[1];
        expect(header).toBeDefined();
        expect(secret).toBeDefined();
        const row = doc.split("\n").find((line) => line.startsWith(`| ${provider} |`));
        expect(row).toBeDefined();
        expect(row).toContain(`\`${header}\``);
        expect(row).toContain(`\`${secret}\``);
        expect(row?.trimEnd().endsWith("? |")).toBe(true);
        const hint = stub.match(/\/\/ {3}\/\/ (.+)\n\/\/ {3}\/\/ Verify over/)?.[1];
        for (const token of [...(hint ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1])) {
          expect(row).toContain(`\`${token}\``);
        }
      }

      // The doc claims names-only vault access: no secret is revealed or added.
      expect(harness.callsTo("reveal")).toEqual([]);
      expect(harness.callsTo("add")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  it("keeps question groups unanswered, links resolvable, and no verification claim", () => {
    for (const statement of [
      "`TODO(security)`",
      "NOT implemented",
      "**unanswered**",
      ".stack/webhooks/<provider>.ts",
      "does not answer",
    ]) {
      expect(doc).toContain(statement);
    }
    // The doc records questions; it must not claim verification exists.
    expect(doc).not.toMatch(
      /signature verification is implemented|verifies the signature|request is authenticated/i,
    );

    const links = [...doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
    expect(links).toContain("../packages/core/src/ai/phantom-wire.ts");
    for (const link of links) {
      expect(existsSync(new URL(link, docUrl))).toBe(true);
    }

    for (const heading of [
      "Scheme and headers",
      "Signed bytes",
      "Secret material",
      "Freshness and comparison",
      "Failure handling and evidence",
    ]) {
      const section = doc.split(`### ${heading}\n`)[1]?.split(/\n#{2,3} /)[0];
      expect(section).toBeDefined();
      expect(section?.match(/^- [\s\S]*?\?$/gm)?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
  });
});
