import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const docUrl = new URL("../docs/phantom-wire-review-questions.md", import.meta.url);
const doc = readFileSync(docUrl, "utf8");

describe("Phantom wire review questions", () => {
  it("keeps source links resolvable and covers each review boundary with questions", () => {
    const links = [...doc.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)].map((match) => match[1]);
    expect(links).toContain("../packages/core/src/ai/phantom-wire.ts");
    expect(links).toContain("../packages/core/src/ai/recipe.ts");
    expect(links).toContain("../packages/cli/src/commands/apply.ts");
    for (const link of links) expect(existsSync(new URL(link, docUrl))).toBe(true);

    for (const heading of ["Message origin", "Verification", "Failure handling"]) {
      const section = doc.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
      expect(section).toBeDefined();
      expect(section).toContain("../packages/");
      const questions = section?.match(/^- [\s\S]*?\?$/gm) ?? [];
      expect(questions.length).toBeGreaterThanOrEqual(3);
    }
  });
});
