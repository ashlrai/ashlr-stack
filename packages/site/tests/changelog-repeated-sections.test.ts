import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-repeated-sections.md"), "utf8");

/** Every list entry as `version / section / text`, in file order; the nearest preceding `##` and `###` headings win. */
function entries(markdown: string): string[] {
  let version = "";
  let section = "";
  const out: string[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth === 2) {
      version = token.text;
      section = "";
    } else if (token.type === "heading" && token.depth === 3) {
      section = token.text;
    } else if (token.type === "list") {
      for (const item of token.items) out.push(`${version} / ${section} / ${item.text}`);
    }
  }
  return out;
}

test("entries stay with their version and section when a section heading repeats", () => {
  expect(entries(fixture)).toEqual([
    "0.3.0 (2026-03-01) / Added / New alpha feature",
    "0.3.0 (2026-03-01) / Fixed / Alpha fix in 0.3.0",
    "0.3.0 (2026-03-01) / Added / Second Added block in 0.3.0",
    "0.2.0 (2026-02-01) / Added / Beta feature in 0.2.0",
    "0.2.0 (2026-02-01) / Fixed / Beta fix in 0.2.0",
  ]);
});

test("the same section name under different versions never merges across versions", () => {
  const added = entries(fixture).filter((e) => e.includes(" / Added / "));
  expect(added.filter((e) => e.startsWith("0.3.0"))).toHaveLength(2);
  expect(added.filter((e) => e.startsWith("0.2.0"))).toHaveLength(1);
});

test("section headings are counted per occurrence, not deduplicated", () => {
  const sections = marked.lexer(fixture).filter((t) => t.type === "heading" && t.depth === 3);
  expect(sections.map((t) => (t as { text: string }).text)).toEqual(["Added", "Fixed", "Added", "Added", "Fixed"]);
});
