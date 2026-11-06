import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-unicode-entry.md"), "utf8");

/** ASCII-digit semver `##` headings only, each with the raw text of its list entries. */
function parse(markdown: string): { heading: string; version: string; entries: string[] }[] {
  const out: { heading: string; version: string; entries: string[] }[] = [];
  let current: (typeof out)[number] | null = null;
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth === 2) {
      const m = t.text.match(/^\[?([0-9]+\.[0-9]+\.[0-9]+)\]?(?:\s|$)/);
      current = m ? { heading: t.text, version: m[1], entries: [] } : null;
      if (current) out.push(current);
    } else if (current && t.type === "list") {
      for (const item of t.items) current.entries.push(item.text);
    }
  }
  return out;
}

test("a Unicode heading suffix keeps its version and exact text", () => {
  const [first] = parse(fixture);
  expect(first.version).toBe("3.1.0");
  expect(first.heading).toBe("[3.1.0] - 2026-11-01 · 長期サポート");
});

test("decomposed text, ZWJ sequences and non-Latin scripts survive byte for byte", () => {
  const [first, second] = parse(fixture);
  expect(first.entries[0]).toBe("Café menu: combining accent stays decomposed (NFD)");
  expect(first.entries[0]).not.toBe(first.entries[0].normalize("NFC"));
  expect(first.entries[3]).toBe("👨‍👩‍👧 family emoji (ZWJ sequence) is one entry");
  expect(second.entries).toEqual(["Ελληνικά → עברית → 한국어 in one entry"]);
});

test("Unicode inside link text, URLs and code spans stays on its version", () => {
  const [first] = parse(fixture);
  expect(first.entries[1]).toContain("[Ünïcödé guide](https://example.com/ü?q=日本)");
  expect(first.entries[2]).toBe("Run `stack añadir ✨` to add a provider");
  const link = marked.lexer(fixture).flatMap((t) => (t.type === "list" ? t.items : []))[1].tokens[0];
  expect(JSON.stringify(link)).toContain("Ünïcödé guide");
});

test("fullwidth digits are not a version, so their entry is not attributed", () => {
  expect(parse(fixture).map((v) => v.version)).toEqual(["3.1.0", "3.0.0"]);
  expect(parse(fixture).flatMap((v) => v.entries).some((e) => e.startsWith("Not a version"))).toBe(false);
});
