import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

const root = join(import.meta.dir, "../../..");

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order; `raw` is the body's exact source text, blank lines included. */
function parseVersions(markdown: string): { heading: string; body: Token[]; raw: string }[] {
  const versions: { heading: string; body: Token[]; raw: string }[] = [];
  let current: { heading: string; body: Token[]; raw: string } | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 && VERSION.test(token.text) ? { heading: token.text, body: [], raw: "" } : null;
      if (current) versions.push(current);
    } else if (current) {
      current.body.push(token);
      current.raw += token.raw;
    }
  }
  return versions;
}

test("blank lines inside a version body stay in the parsed body", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-blank-lines.md"), "utf8");
  const [newer, older] = parseVersions(fixture);

  // Every blank-line run between blocks survives as a `space` token, not dropped.
  expect(newer.body.filter((t) => t.type === "space").length).toBeGreaterThan(0);
  // The multi-blank-line gaps are preserved verbatim in the body's raw text.
  expect(newer.raw).toContain("- Second item after two blank lines.\n\nParagraph one.\n\n\n\nParagraph two.");
  // A blank line inside a fenced code block is part of the code, not a separator.
  const code = newer.body.find((t) => t.type === "code") as { text: string } | undefined;
  expect(code?.text).toBe("line a\n\nline b");
  // Each body keeps only its own blank lines: the gap before `## 0.1.0` stays with the newer version.
  expect(newer.raw.endsWith("```\n\n")).toBe(true);
  expect(older.raw.trim()).toBe("- Only item.");
});

test("blank lines in the published changelog stay inside their version body", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  for (const v of parseVersions(published)) {
    // Body raw text is the source slice between headings: blank lines between blocks are retained.
    expect(v.raw).toContain("\n\n");
    expect(v.raw.trim().length).toBeGreaterThan(0);
  }
});
