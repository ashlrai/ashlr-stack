import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const HEADING = /^\[?(\d+\.\d+\.\d+)\]?(?:\s*(?:—|-|\()\s*(\d{4}-\d{2}-\d{2})\)?)?/;

/** Released versions as `{ version, date, entries }`; entries are the top-level list items under each `##` version heading, section headings or not. */
function parseReleases(markdown: string): { version: string; date: string | null; entries: string[] }[] {
  const releases: { version: string; date: string | null; entries: string[] }[] = [];
  let current: (typeof releases)[number] | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      const match = token.depth === 2 ? HEADING.exec(token.text) : null;
      current = match ? { version: match[1], date: match[2] ?? null, entries: [] } : null;
      if (current) releases.push(current);
    } else if (current && token.type === "list") {
      current.entries.push(...token.items.map((item: { text: string }) => item.text));
    }
  }
  return releases;
}

test("version-entry fixture parses to its version, date and single entry", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-version-entry.md"), "utf8");
  expect(parseReleases(fixture)).toEqual([
    { version: "0.9.0", date: "2026-11-02", entries: ["The one entry, with no section heading."] },
  ]);
});

test("release parsing handles undated headings and skips Unreleased", () => {
  expect(parseReleases("## Unreleased\n\n- pending\n\n## 0.1.0\n\n- first\n")).toEqual([
    { version: "0.1.0", date: null, entries: ["first"] },
  ]);
});

test("the published site changelog parses with a version and entries for every release", () => {
  const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const releases = parseReleases(published);
  expect(releases.length).toBeGreaterThan(0);
  for (const release of releases) expect(release.entries.length, release.version).toBeGreaterThan(0);
});
