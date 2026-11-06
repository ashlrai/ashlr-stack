import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

const root = join(import.meta.dir, "../../..");

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order; `raw` is the body's exact source text. */
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

/** Recursively collect all `codespan` tokens from a token tree (descends into list items). */
function collectCodespans(tokens: Token[]): Token[] {
  const spans: Token[] = [];
  for (const t of tokens) {
    if (t.type === "codespan") spans.push(t);
    if ("tokens" in t && Array.isArray((t as any).tokens)) {
      spans.push(...collectCodespans((t as any).tokens));
    }
    if (t.type === "list" && Array.isArray((t as any).items)) {
      for (const item of (t as any).items) {
        if ("tokens" in item && Array.isArray(item.tokens)) {
          spans.push(...collectCodespans(item.tokens));
        }
      }
    }
  }
  return spans;
}

test("inline code entries are retained as codespan tokens with delimiters", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code.md"), "utf8");
  const versions = parseVersions(fixture);
  expect(versions).toHaveLength(2);

  const [newer, older] = versions;
  expect(newer.heading).toBe("0.2.0 (2026-05-01)");
  expect(older.heading).toBe("0.1.0 (2026-04-19)");

  // Each version body retains its inline code as codespan tokens.
  const newerSpans = collectCodespans(newer.body);
  expect(newerSpans.map((s) => s.text)).toEqual(["stack apply", "OPENAI_API_KEY", "~/.env", "--noWire"]);
  // The `raw` field keeps the backtick delimiters.
  expect(newerSpans.map((s) => s.raw)).toEqual(["`stack apply`", "`OPENAI_API_KEY`", "`~/.env`", "`--noWire`"]);

  const olderSpans = collectCodespans(older.body);
  expect(olderSpans.map((s) => s.text)).toEqual(["stack scan"]);
  expect(olderSpans.map((s) => s.raw)).toEqual(["`stack scan`"]);

  // The accumulated raw body preserves inline code with its delimiters.
  expect(newer.raw).toContain("`stack apply`");
  expect(newer.raw).toContain("`OPENAI_API_KEY`");
  expect(newer.raw).toContain("`~/.env`");
  expect(newer.raw).toContain("`--noWire`");
  expect(older.raw).toContain("`stack scan`");
});

test("published changelog retains inline code with delimiters in version bodies", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const versions = parseVersions(published);
  expect(versions.length).toBeGreaterThan(0);

  for (const v of versions) {
    const spans = collectCodespans(v.body);
    // Every codespan token's raw field preserves the backtick delimiters.
    for (const span of spans) {
      expect(span.raw.startsWith("`")).toBe(true);
      expect(span.raw.endsWith("`")).toBe(true);
    }
    // The raw body text (accumulated from token.raw) contains the delimiters.
    for (const span of spans) {
      expect(v.raw).toContain(span.raw);
    }
  }
});
