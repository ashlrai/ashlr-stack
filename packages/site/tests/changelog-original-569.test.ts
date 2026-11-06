import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

/** A `##` heading that opens with a semver (either bare or bracketed). */
const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order: heading text and the body tokens before the next `##` heading. */
function parseVersions(markdown: string): { heading: string; body: Token[] }[] {
  const versions: { heading: string; body: Token[] }[] = [];
  let current: { heading: string; body: Token[] } | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current =
        token.depth === 2 && VERSION.test(token.text)
          ? { heading: token.text, body: [] }
          : null;
      if (current) versions.push(current);
    } else if (current) {
      current.body.push(token);
    }
  }
  return versions;
}

/** Plain-text list items from a version body, flattening through list tokens. */
function listItems(body: Token[]): string[] {
  return body.flatMap((t) =>
    t.type === "list" ? t.items.map((i: { text: string }) => i.text) : []
  );
}

test("CRLF fixture has carriage returns in the raw file", () => {
  const raw = readFileSync(
    join(import.meta.dir, "__fixtures__/changelog-original-569-crlf.md"),
    "utf8"
  );
  expect(raw).toContain("\r\n");
  expect(raw).not.toMatch(/\r\r/);
});

test("CRLF fixture version headings parse identically to the LF fixture", () => {
  const crlf = readFileSync(
    join(import.meta.dir, "__fixtures__/changelog-original-569-crlf.md"),
    "utf8"
  );
  const lf = readFileSync(
    join(import.meta.dir, "__fixtures__/changelog-three-versions.md"),
    "utf8"
  );

  const crlfVersions = parseVersions(crlf);
  const lfVersions = parseVersions(lf);

  expect(crlfVersions.map((v) => v.heading)).toEqual(lfVersions.map((v) => v.heading));
});

test("CRLF fixture version bodies parse identically to the LF fixture", () => {
  const crlf = readFileSync(
    join(import.meta.dir, "__fixtures__/changelog-original-569-crlf.md"),
    "utf8"
  );
  const lf = readFileSync(
    join(import.meta.dir, "__fixtures__/changelog-three-versions.md"),
    "utf8"
  );

  const crlfVersions = parseVersions(crlf);
  const lfVersions = parseVersions(lf);

  // Each version's list-item text matches between CRLF and LF.
  for (let i = 0; i < crlfVersions.length; i++) {
    expect(listItems(crlfVersions[i].body)).toEqual(listItems(lfVersions[i].body));
  }
});

test("CRLF fixture section headings parse correctly", () => {
  const crlf = readFileSync(
    join(import.meta.dir, "__fixtures__/changelog-original-569-crlf.md"),
    "utf8"
  );
  const tokens = marked.lexer(crlf);
  const sectionHeadings = tokens
    .filter((t) => t.type === "heading" && t.depth === 3)
    .map((t) => t.text);

  expect(sectionHeadings).toEqual(["Added", "Fixed"]);
});

test("CRLF fixture list item text has no stray carriage returns", () => {
  const crlf = readFileSync(
    join(import.meta.dir, "__fixtures__/changelog-original-569-crlf.md"),
    "utf8"
  );
  const versions = parseVersions(crlf);
  const allItems = versions.flatMap((v) => listItems(v.body));

  // Each item's parsed text is clean — no \r left in the text field.
  for (const item of allItems) {
    expect(item).not.toContain("\r");
  }
  expect(allItems).toEqual([
    "Third version entry.",
    "Second version entry.",
    "First version entry.",
  ]);
});
