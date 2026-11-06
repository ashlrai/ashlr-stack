import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");

/** Versions (e.g. "0.3.0") that appear in more than one `##` release heading. */
function duplicateVersions(markdown: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const token of marked.lexer(markdown)) {
    if (token.type !== "heading" || token.depth !== 2) continue;
    const match = token.text.match(/^\[?(\d+\.\d+\.\d+)\]?(?:\s|$)/);
    if (!match) continue;
    if (seen.has(match[1])) duplicates.add(match[1]);
    seen.add(match[1]);
  }
  return [...duplicates];
}

/** Release headings (or `null`) that contain a `stack apply` entry. */
function historicalApplyReleases(markdown: string): (string | null)[] {
  let release: string | null = null;
  const releases: (string | null)[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      release = token.depth === 2 && /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/.test(token.text) ? token.text : null;
    }
    if (token.type === "list") {
      for (const item of token.items) {
        if (item.raw.startsWith("- **`stack apply [recipe-id]`**")) releases.push(release);
      }
    }
  }
  return releases;
}

test("empty fixture returns no tokens without throwing", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-original-586-empty.md"), "utf8");
  expect(fixture).toBe("");
  const tokens = marked.lexer(fixture);
  expect(tokens).toEqual([]);
});

test("empty fixture returns no entries for all changelog parsers", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-original-586-empty.md"), "utf8");

  // Lexer produces no tokens, so downstream parsers return empty arrays.
  expect(historicalApplyReleases(fixture)).toEqual([]);
  expect(duplicateVersions(fixture)).toEqual([]);
});

test("empty string input also returns no entries without throwing", () => {
  expect(marked.lexer("")).toEqual([]);
  expect(historicalApplyReleases("")).toEqual([]);
  expect(duplicateVersions("")).toEqual([]);
});

test("published changelog parser does not throw on the live file", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(() => marked.lexer(published)).not.toThrow();
  expect(() => historicalApplyReleases(published)).not.toThrow();
  expect(() => duplicateVersions(published)).not.toThrow();
});
