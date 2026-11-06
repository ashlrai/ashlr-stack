import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const root = readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8");

/** Each `##` heading with the list entries under it (all `###` sections flattened). */
function parseReleases(markdown: string): { heading: string; entries: string[] }[] {
  const out: { heading: string; entries: string[] }[] = [];
  let current: { heading: string; entries: string[] } | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 ? { heading: token.text, entries: [] } : null;
      if (current) out.push(current);
    } else if (token.type === "list" && current) {
      current.entries.push(...(token as Tokens.List).items.map((item) => item.text));
    }
  }
  return out;
}

test("the root CHANGELOG.md parses without throwing into a nonempty result", () => {
  const releases = parseReleases(root);
  expect(releases.length).toBeGreaterThan(0);
  expect(releases.some((r) => r.entries.length > 0)).toBe(true);
});

test("empty input fixture parses to no releases without throwing", () => {
  const empty = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-input.md"), "utf8");
  expect(empty).toBe("");
  expect(() => parseReleases(empty)).not.toThrow();
  expect(parseReleases(empty)).toEqual([]);
  expect(parseReleases("\n\n  \n")).toEqual([]);
});
