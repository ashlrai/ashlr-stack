import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released version headings in source order. */
function versionHeadings(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .flatMap((t) => (t.type === "heading" && t.depth === 2 && VERSION.test(t.text) ? [t.text] : []));
}

test("empty fixture parses to no entries without throwing", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-input.md"), "utf8");
  expect(fixture).toBe("");
  expect(() => versionHeadings(fixture)).not.toThrow();
  expect(versionHeadings(fixture)).toEqual([]);
});

test("whitespace-only and heading-only input also yield no entries", () => {
  for (const input of ["\n", "\r\n\r\n", "  \n\t\n", "# Changelog\n", "# Changelog\n\n## Unreleased\n"]) {
    expect(versionHeadings(input)).toEqual([]);
  }
});

test("an HTML comment containing a version heading yields no entries", () => {
  expect(versionHeadings("<!--\n## 1.2.3\n-->\n")).toEqual([]);
});

test("the published changelog is not empty, so the empty fixture is a real contrast", () => {
  const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  expect(versionHeadings(published).length).toBeGreaterThan(0);
});

test("the docs page transform renders empty input as empty HTML", async () => {
  // Same steps as src/pages/docs/changelog.astro: strip the H1, then marked.parse.
  const body = "".replace(/^#\s+Changelog\s*\n+/, "");
  expect(await marked.parse(body)).toBe("");
});

test("the docs page renders a whitespace-only fixture without version entries", async () => {
  const fixture = " \t\n\r\n  \n";
  const body = fixture.replace(/^#\s+Changelog\s*\n+/, "");
  const html = await marked.parse(body);

  expect(html.trim()).toBe("");
  expect(versionHeadings(fixture)).toEqual([]);
});

/** Version → section → entries, the same shape the entry-level fixture tests use. */
function entriesBySection(markdown: string): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  let version: string | null = null;
  let section = "";
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth <= 2) {
      version = t.depth === 2 && VERSION.test(t.text) ? t.text : null;
      section = "";
      if (version) out[version] = {};
    } else if (version && t.type === "heading" && t.depth === 3) {
      section = t.text;
    } else if (version && t.type === "list") {
      (out[version][section] ??= []).push(...t.items.map((item) => item.text));
    }
  }
  return out;
}

test("empty fixture yields no entries or sections, and no list items at all", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-input.md"), "utf8");
  expect(() => entriesBySection(fixture)).not.toThrow();
  expect(entriesBySection(fixture)).toEqual({});
  expect(marked.lexer(fixture).flatMap((t) => (t.type === "list" ? t.items : []))).toEqual([]);
});

test("a version heading without list items is recognized with no entries", () => {
  const markdown = "# Changelog\n\n## 1.2.3\n";

  expect(versionHeadings(markdown)).toEqual(["1.2.3"]);
  expect(entriesBySection(markdown)).toEqual({ "1.2.3": {} });
  expect(marked.lexer(markdown).flatMap((t) => (t.type === "list" ? t.items : []))).toEqual([]);
});
