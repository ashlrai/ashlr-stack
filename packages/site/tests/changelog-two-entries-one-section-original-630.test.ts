import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-two-entries-one-section-original-630.md"), "utf8");

/** Entry texts under the `###` section named `name`, in source order. */
function entriesIn(markdown: string, name: string): string[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 3 && t.text === name);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 3);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .flatMap((t) => (t.type === "list" ? (t as Tokens.List).items.map((i) => i.text) : []));
}

test("both entries appear once, in source order, under their section", () => {
  expect(entriesIn(fixture, "Added")).toEqual(["First entry in the section.", "Second entry in the section."]);
});

test("a neighbouring section does not receive those entries", () => {
  expect(entriesIn(fixture, "Fixed")).toEqual(["Entry in a different section."]);
});
