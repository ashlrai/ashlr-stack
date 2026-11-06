import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

const VERSION = /^\[\d+\.\d+\.\d+\]/;

type Section = { heading: string; body: Token[] };

function parseVersions(markdown: string): Section[] {
  const out: Section[] = [];
  let current: Section | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 && VERSION.test(token.text) ? { heading: token.text, body: [] } : null;
      if (current) out.push(current);
    } else if (current) {
      current.body.push(token);
    }
  }
  return out;
}

/** Code spans in a token tree, depth-first. marked nests list items under `items[].tokens`. */
function codespans(tokens: Token[]): string[] {
  const found: string[] = [];
  for (const t of tokens as any[]) {
    if (t.type === "codespan") found.push(t.text);
    if (Array.isArray(t.tokens)) found.push(...codespans(t.tokens));
    if (Array.isArray(t.items)) found.push(...codespans(t.items));
  }
  return found;
}

test("inline code stays on its own version, including edge cases", () => {
  const md = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code-attribution.md"), "utf8");
  const versions = parseVersions(md);

  // A code span that looks like a `## 9.9.9` heading must not create a version.
  expect(versions.map((v) => v.heading)).toEqual([
    "[0.3.0] - 2026-06-01",
    "[0.2.0] - 2026-05-01",
    "[0.1.0] - 2026-04-19",
  ]);

  expect(codespans(versions[0].body)).toEqual(["stack doctor", "## 9.9.9"]);
  // Double-backtick span keeps its inner backticks; nested list and trailing paragraph stay with 0.2.0.
  expect(codespans(versions[1].body)).toEqual(["a `nested` span", "stack.json", "# not a heading", "--flag=value"]);
  expect(codespans(versions[2].body)).toEqual(["stack init"]);
});
