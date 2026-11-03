import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-punctuation.md"), "utf8");

/** Entries (list items) in the body of the `##` section whose heading text is exactly `heading`. */
function entriesFor(heading: string): Tokens.ListItem[] {
  const tokens = marked.lexer(fixture);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((l) => l.items);
}

test("entry text keeps its punctuation verbatim", () => {
  expect(entriesFor("0.5.0 (2026-11-02)").map((e) => e.text)).toEqual([
    `Don't crash: "stack add" now handles semicolons; commas, too! Really? Yes... (see below) - done.`,
    "Fees & taxes: 5% off, $10 -> $9, a/b, c|d, e@f, #7, 3 < 4 > 2.",
    "Dash — en–dash, “curly quotes”, ‘single’, and an ellipsis…",
    "Escaped \\*stars\\*, \\_underscores\\_, \\[brackets\\] and \\`ticks\\`.",
  ]);
});

test("a neighbouring plain entry is unaffected", () => {
  expect(entriesFor("0.4.0 (2026-11-01)").map((e) => e.text)).toEqual(["Plain entry."]);
});

test("rendered HTML escapes markup characters and unescapes backslash escapes", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("Fees &amp; taxes: 5% off, $10 -&gt; $9, a/b, c|d, e@f, #7, 3 &lt; 4 &gt; 2.");
  expect(html).toContain("Escaped *stars*, _underscores_, [brackets] and `ticks`.");
  expect(html).toContain("“curly quotes”, ‘single’, and an ellipsis…");
  expect(html).not.toContain("<em>");
});
