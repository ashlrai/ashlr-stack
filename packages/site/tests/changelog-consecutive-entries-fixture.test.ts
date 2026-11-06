import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

// Two consecutive entries excerpted from the root CHANGELOG.md "Unreleased / Fixed" section.
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-consecutive-entries.md"), "utf8");

/** Top-level list entries in the fixture, in the order the parser returns them. */
function entries(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items.map((item) => item.text));
}

test("two consecutive CHANGELOG.md entries are returned in source order", () => {
  const found = entries(fixture);
  expect(found).toHaveLength(2);
  expect(found[0]).toStartWith("Fleet JSONL reads");
  expect(found[1]).toStartWith("The release workflow renders");
});

test("each entry sits at a later line of the fixture than the one before it", () => {
  const lines = fixture.split("\n");
  const at = entries(fixture).map((e) => lines.findIndex((l) => l.includes(e.slice(0, 40))));
  expect(at.every((n) => n >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
});
