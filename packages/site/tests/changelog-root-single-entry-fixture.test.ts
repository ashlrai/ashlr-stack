import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-root-single-entry.md"), "utf8");
const rootChangelog = readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8");

/** Released versions (`## x.y.z ...` or `## [x.y.z] ...`) with their list entry text, in source order. */
function parseReleases(markdown: string): { version: string; entries: string[] }[] {
  const releases: { version: string; entries: string[] }[] = [];
  let current: { version: string; entries: string[] } | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      const match = token.depth === 2 ? token.text.match(/^\[?(\d+\.\d+\.\d+)\]?(?:\s|$)/) : null;
      current = match ? { version: match[1], entries: [] } : null;
      if (current) releases.push(current);
    } else if (token.type === "list" && current) {
      current.entries.push(...(token as Tokens.List).items.map((item) => item.text));
    }
  }
  return releases;
}

test("root-based fixture parses to one version with one entry", () => {
  expect(parseReleases(fixture)).toEqual([
    {
      version: "0.3.0",
      entries: [
        "`stack doctor --repos` reports default-branch CI and open PR counts through gh. Only --json may be combined with this mode.",
      ],
    },
  ]);
});

test("fixture version and entry text still match the root CHANGELOG.md", () => {
  const [fixtureRelease] = parseReleases(fixture);
  const rootRelease = parseReleases(rootChangelog).find((r) => r.version === fixtureRelease.version);
  expect(rootRelease).toBeDefined();
  expect(rootRelease!.entries).toContain(fixtureRelease.entries[0]);
});
