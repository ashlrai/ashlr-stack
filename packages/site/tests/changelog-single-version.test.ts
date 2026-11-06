import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

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

test("single-version fixture parses to one entry with its version and body", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-single-version.md"), "utf8");
  const versions = parseVersions(fixture);
  expect(versions).toHaveLength(1);
  expect(versions[0].heading).toBe("0.1.0 (2026-04-19)");
  expect(versions[0].body.some((t) => t.type === "heading" && t.depth === 3 && t.text === "Added")).toBe(true);
  expect(listItems(versions[0].body)).toEqual(["Only version entry."]);
});

test("single-version parsing also covers the bracketed heading style and ignores `## Unreleased`", () => {
  const versions = parseVersions("# Changelog\n\n## Unreleased\n\n- Not a release.\n\n## [0.2.0] — 2026-04-23\n\n- Entry.\n");
  expect(versions.map((v) => v.heading)).toEqual(["[0.2.0] — 2026-04-23"]);
  expect(listItems(versions[0].body)).toEqual(["Entry."]);
});
