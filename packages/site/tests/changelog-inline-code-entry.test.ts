import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code-entry.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** Code span text found anywhere inside one token tree, in source order. */
function spans(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    const children = (t as { tokens?: Token[] }).tokens ?? [];
    return [...(t.type === "codespan" ? [t.text] : []), ...spans(children)];
  });
}

/** Each list entry under the `##` heading with this exact text: its source text and code spans. */
function entries(markdown: string, version: string): { text: string; code: string[] }[] {
  const tokens = marked.lexer(markdown);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items.map((item) => ({ text: item.text, code: spans(item.tokens) })));
}

test("a parsed entry retains its code span text, one entry at a time", () => {
  const parsed = entries(fixture, "0.2.0 (2026-05-01)");
  expect(parsed.map((e) => e.code)).toEqual([
    ["stack add <provider>", "--dry-run"],
    ["stack apply", "OPENAI_API_KEY"],
    [],
    [" padded ", "a | b"],
  ]);
  // CommonMark strips one space from each side of a span, so two padding spaces leave one.
  // The entry's own text still carries the backtick delimiters around each span.
  expect(parsed[0].text).toBe("Run `stack add <provider>` to wire a provider; `--dry-run` previews it.");
  // The span's line break becomes a space in the span; the entry text keeps the break, minus list indent.
  expect(parsed[1].text).toContain("**`stack apply`**");
});

test("a parsed entry keeps the delimiters and raw content of padded and piped spans", () => {
  const parsed = entries(fixture, "0.2.0 (2026-05-01)");
  expect(parsed[1].text).toBe("**`stack apply`** keeps the `OPENAI_API_KEY` name, never its value.");
  expect(parsed[3].text).toBe("Spaces inside a span: `  padded  ` and a pipe `a | b`.");
});

test("code spans do not leak into the neighbouring version's entries", () => {
  expect(entries(fixture, "0.1.0 (2026-04-19)").map((e) => e.code)).toEqual([["stack scan"]]);
});

test("every published Unreleased entry keeps each code span inside its own text", () => {
  const parsed = entries(published, "Unreleased");
  expect(parsed.length).toBeGreaterThan(0);
  for (const entry of parsed) {
    for (const code of entry.code) expect(entry.text).toContain(code);
  }
  expect(parsed.flatMap((e) => e.code)).toContain("stack apply");
});

test("a parsed entry keeps double-backtick fences, wrapped spans, nested spans and literal markup", () => {
  const parsed = entries(fixture, "0.3.0 (2026-06-01)");
  expect(parsed.map((e) => e.code)).toEqual([
    ["stack run`cmd"],
    ["stack doctor"],
    ["stack fleet"],
    ["<b>&amp;</b>"],
  ]);
  expect(parsed[0].text).toContain("``stack run`cmd``");
  // The span's line break becomes a space in the span; the entry text keeps the break, minus list indent.
  expect(parsed[1].text).toContain("`stack\ndoctor`");
  // Nested list items are their own entries; the parent's text still carries the child's raw source.
  expect(parsed[2].text).toContain("nested child keeps `--json` too.");
});

test("rendered HTML escapes span contents instead of treating them as markup", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("<code>&lt;b&gt;&amp;amp;&lt;/b&gt;</code>");
  expect(html).toContain("<code>stack run`cmd</code>");
});

test("every published release keeps each code span inside its own entry text", () => {
  const versions = marked
    .lexer(published)
    .filter((t) => t.type === "heading" && t.depth === 2)
    .map((t) => (t as Tokens.Heading).text);
  expect(versions.length).toBeGreaterThan(1);
  for (const version of versions) {
    for (const entry of entries(published, version)) {
      for (const code of entry.code) expect(entry.text).toContain(code);
    }
  }
});
