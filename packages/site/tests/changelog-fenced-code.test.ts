import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const root = join(import.meta.dir, "../../..");
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-fenced-code.md"), "utf8");

const edges = readFileSync(join(import.meta.dir, "__fixtures__/changelog-fenced-code-edges.md"), "utf8");

type Entry = { version: string; raw: string };

/** Top-level `##`/`#` headings (the only section boundaries) and the list entries under each. */
function entries(markdown: string): { versions: string[]; entries: Entry[] } {
  const versions: string[] = [];
  const found: Entry[] = [];
  let version = "";
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      version = token.depth === 2 ? token.text : "";
      if (token.depth === 2) versions.push(version);
    }
    if (token.type === "list") {
      for (const item of (token as Tokens.List).items) found.push({ version, raw: item.raw });
    }
  }
  return { versions, entries: found };
}

test("heading-like lines inside a code fence stay in their entry body", () => {
  const { versions, entries: found } = entries(fixture);
  expect(versions).toEqual(["Unreleased", "0.6.0 (2026-11-02)", "0.5.0 (2026-10-01)"]);

  const fenced = found.filter((e) => e.version === "0.6.0 (2026-11-02)");
  expect(fenced).toHaveLength(2);
  for (const line of ["## 9.9.9 (2026-01-01)", "### Fake section", "# Fake title"]) {
    expect(fenced[0].raw).toContain(line);
  }
  expect(fenced[0].raw).toContain("Prose after the fence still belongs to the entry.");
  expect(fenced[1].raw).not.toContain("9.9.9");
});

test("a fenced heading never opens a version section", () => {
  const { versions } = entries(fixture);
  expect(versions).not.toContain("9.9.9 (2026-01-01)");
  expect(versions).not.toContain("8.8.8 (2026-01-01)");
});

test("tilde fences keep heading-like lines out of the section list", () => {
  const tokens = marked.lexer(fixture);
  const code = tokens.filter((t): t is Tokens.Code => t.type === "code");
  expect(code.map((t) => t.text)).toContain("## 8.8.8 (2026-01-01)");
});

test("longer fences, nested lists and an unterminated fence never create versions or sections", () => {
  const tokens = marked.lexer(edges);
  const headings = tokens.flatMap((t) => (t.type === "heading" ? [`${t.depth}:${t.text}`] : []));
  expect(headings).toEqual(["1:Changelog", "2:0.7.0 (2026-11-02)", "2:0.6.0 (2026-10-01)"]);

  const { entries: found } = entries(edges);
  expect(found[0].raw).toContain("## 7.7.7 (2026-01-01)");
  expect(found[0].raw).toContain("## 6.6.6 (2026-01-01)");
  expect(found[1].raw).toContain("## 5.5.5 (2026-01-01)");
  expect(JSON.stringify(headings)).not.toMatch(/[4567]\.[4567]\.[4567]|Unterminated/);
});

for (const [label, path] of [
  ["root CHANGELOG.md", "CHANGELOG.md"],
  ["site changelog", "packages/site/src/data/CHANGELOG.md"],
] as const) {
  test(`${label}: every fenced heading-like line is code, not a heading`, () => {
    const markdown = readFileSync(join(root, path), "utf8");
    const headings = new Set(
      marked.lexer(markdown).flatMap((t) => (t.type === "heading" ? [t.raw.trim()] : [])),
    );
    let inFence = false;
    for (const line of markdown.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      else if (inFence && /^\s*#{1,6} /.test(line)) expect(headings.has(line.trim())).toBe(false);
    }
  });
}
