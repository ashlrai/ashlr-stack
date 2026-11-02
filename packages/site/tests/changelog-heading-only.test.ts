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

const content = (body: Token[]) => body.filter((t) => t.type !== "space");

test("heading-only fixture keeps the trailing version with an empty body", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-heading-only.md"), "utf8");
  const versions = parseVersions(fixture);
  expect(versions.map((v) => v.heading)).toEqual(["0.2.0 (2026-04-23)", "0.1.0 (2026-04-19)"]);
  expect(content(versions[0].body)).toHaveLength(1);
  expect(content(versions[1].body)).toEqual([]);
});

test("a heading-only version is retained in every position without throwing", () => {
  expect(() => parseVersions("## 0.1.0")).not.toThrow();
  expect(parseVersions("## 0.1.0").map((v) => v.heading)).toEqual(["0.1.0"]);
  const middle = parseVersions("## 0.3.0\n\n- a\n\n## 0.2.0\n\n## 0.1.0\n\n- b\n");
  expect(middle.map((v) => v.heading)).toEqual(["0.3.0", "0.2.0", "0.1.0"]);
  expect(content(middle[1].body)).toEqual([]);
  const bracketed = parseVersions("## [0.2.0] — 2026-04-23\n\n## [0.1.0]\n");
  expect(bracketed.map((v) => v.heading)).toEqual(["[0.2.0] — 2026-04-23", "[0.1.0]"]);
  expect(bracketed.every((v) => content(v.body).length === 0)).toBe(true);
});
