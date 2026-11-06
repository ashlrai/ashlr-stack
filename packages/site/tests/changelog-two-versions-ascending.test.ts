import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-two-versions-ascending.md"), "utf8");

type Release = { version: string; entries: string[] };

/** Each `##` version with every list entry under it (all `###` sections flattened), in source order. */
function parseReleases(markdown: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 ? { version: token.text, entries: [] } : null;
      if (current) releases.push(current);
    } else if (token.type === "list" && current) {
      current.entries.push(...(token as Tokens.List).items.map((item) => item.text));
    }
  }
  return releases;
}

test("older version written first stays first, and each keeps its entries in written order", () => {
  expect(parseReleases(fixture)).toEqual([
    {
      version: "0.2.0 (2026-04-23)",
      entries: ["Zulu entry written first.", "Alpha entry written second.", "Mike entry written third.", "Bravo entry in a later section."],
    },
    { version: "0.10.0 (2026-11-02)", entries: ["Ten entry written first.", "Two entry written second.", "One entry written third."] },
  ]);
});

test("entries are not alphabetised or otherwise re-sorted", () => {
  for (const { entries } of parseReleases(fixture)) {
    expect(entries).not.toEqual([...entries].sort());
  }
});
