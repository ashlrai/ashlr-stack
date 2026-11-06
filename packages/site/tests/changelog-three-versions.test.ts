import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

const root = join(import.meta.dir, "../../..");

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order: heading text and the tokens up to the next `##` heading. */
function parseVersions(markdown: string): { heading: string; body: Token[] }[] {
  const versions: { heading: string; body: Token[] }[] = [];
  let current: { heading: string; body: Token[] } | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 && VERSION.test(token.text) ? { heading: token.text, body: [] } : null;
      if (current) versions.push(current);
    } else current?.body.push(token);
  }
  return versions;
}

const listItems = (body: Token[]) =>
  body.flatMap((t) => (t.type === "list" ? t.items.map((i: { text: string }) => i.text) : []));

test("three-version fixture parses every version in source order with its own body", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-three-versions.md"), "utf8");
  const versions = parseVersions(fixture);
  expect(versions.map((v) => v.heading)).toEqual(["0.3.0 (2026-05-01)", "[0.2.0] — 2026-04-23", "0.1.0 (2026-04-19)"]);
  expect(versions.map((v) => listItems(v.body))).toEqual([
    ["Third version entry."],
    ["Second version entry."],
    ["First version entry."],
  ]);
});

test("site changelog yields its released versions in source order, each with a body", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const versions = parseVersions(published);
  expect(versions.length).toBeGreaterThanOrEqual(3);
  // `## Unreleased` is not a version, so the first one is the newest release.
  expect(versions[0].heading).toMatch(/^0\.3\.3 \(/);
  for (const v of versions.slice(0, 3)) expect(listItems(v.body).length).toBeGreaterThan(0);
  const headings = versions.map((v) => v.heading);
  expect(new Set(headings).size).toBe(headings.length);
});
