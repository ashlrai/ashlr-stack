import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-punctuation.md"), "utf8");

/** Item texts of the first list under the `##` section whose heading text is exactly `heading`. */
function itemsFor(heading: string): string[] {
  const tokens = marked.lexer(fixture);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  const list = tokens.slice(start + 1, end === -1 ? undefined : end).find((t) => t.type === "list");
  return ((list as Tokens.List | undefined)?.items ?? []).map((i) => i.text);
}

test("entry text keeps every punctuation mark verbatim", () => {
  expect(itemsFor("0.5.0 (2026-11-02)")).toEqual([
    `Fixed: it's "quoted", 'single', and (parenthetical); also [bracketed] text, ellipsis... done!`,
    `Dash - en – em — and slash a/b, backslash a\\b, percent 100%, at user@host, hash #42, dollar $5.`,
    `Ampersand & friends: Q&A, a < b > c, 5 != 6? Yes; no, maybe: really?!`,
    `Trailing punctuation kept.,;:!?`,
  ]);
});

test("the next version is not affected by the punctuation entry", () => {
  expect(itemsFor("0.4.0 (2026-11-01)")).toEqual(["Plain entry with no punctuation specials"]);
});

test("rendered HTML escapes markup characters but keeps the rest", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("Q&amp;A, a &lt; b &gt; c");
  expect(html).toContain("it&#39;s &quot;quoted&quot;");
  expect(html).toContain("ellipsis... done!");
  expect(html).toContain("– em —");
  expect(html).toContain("[bracketed]");
});
