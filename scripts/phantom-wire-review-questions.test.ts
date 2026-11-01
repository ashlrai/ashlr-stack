import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

const docUrl = new URL("../docs/phantom-wire-review-questions.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire review questions", () => {
  it("keeps source links resolvable and covers each review boundary with questions", () => {
    const links = [...doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
    expect(links).toContain("../packages/core/src/ai/phantom-wire.ts");
    expect(links).toContain("../packages/core/src/ai/recipe.ts");
    expect(links).toContain("../packages/cli/src/commands/apply.ts");
    for (const link of links) expect(existsSync(new URL(link, docUrl))).toBe(true);

    for (const heading of ["Message origin", "Verification", "Example status", "Failure handling"]) {
      const section = doc.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
      expect(section).toBeDefined();
      expect(section).toContain("../packages/");
      const questions = section?.match(/^- [\s\S]*?\?$/gm) ?? [];
      expect(questions.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("asks about the actual header and secret named in each generated example", async () => {
    const providers = ["stripe", "clerk", "supabase", "github"];
    const harness = setupFakePhantom();
    try {
      const result = await wirePhantomForRecipe(
        { id: "review", query: "", createdAt: "", providers: providers.map((name) => ({ name })) },
        { cwd: harness.dir },
      );
      expect(result.webhooks).toHaveLength(providers.length);
      for (const [index, path] of result.webhooks.entries()) {
        const stub = readFileSync(path, "utf8");
        const header = stub.match(/req\.headers\.get\("([^"]+)"\)/)?.[1];
        const secret = stub.match(/phantom reveal ([A-Z_]+)/)?.[1];
        expect(header).toBeDefined();
        expect(secret).toBeDefined();
        const row = doc.split("\n").find((line) => line.startsWith(`| ${providers[index]} |`));
        expect(row).toContain(`\`${header}\``);
        expect(row).toContain(`\`${secret}\``);
        expect(row).toContain("?");
      }
      expect(harness.callsTo("reveal")).toEqual([]);
    } finally {
      harness.cleanup();
    }
  }, 30_000);
});
