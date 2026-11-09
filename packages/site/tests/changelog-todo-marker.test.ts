import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const rootDir = join(import.meta.dir, "../../..");
const changelog = readFileSync(join(rootDir, "CHANGELOG.md"), "utf8");

/**
 * Walk the marked token stream and return every list item whose raw text
 * contains the needle, along with the parsed `item.text`.
 */
function findEntriesWith(markdown: string, needle: string): Array<{ raw: string; text: string }> {
  const results: Array<{ raw: string; text: string }> = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === "list") {
      for (const item of (token as Tokens.List).items) {
        if (item.raw.includes(needle)) {
          results.push({ raw: item.raw, text: item.text });
        }
      }
    }
  }
  return results;
}

test("TODO_STACK_APPLY marker is intact in parsed root CHANGELOG.md entries", () => {
  const entries = findEntriesWith(changelog, "TODO_STACK_APPLY");
  expect(entries.length).toBeGreaterThanOrEqual(2);

  for (const entry of entries) {
    // The marker must survive in the raw text (the original markdown line).
    expect(entry.raw).toContain("TODO_STACK_APPLY");
    // And in the parsed text (after marked renders inline code tokens).
    expect(entry.text).toContain("TODO_STACK_APPLY");
  }
});

function findEntryReleases(markdown: string, needle: string): Array<{
  release: string | null;
  raw: string;
  text: string;
}> {
  let release: string | null = null;
  const entries: Array<{ release: string | null; raw: string; text: string }> = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      release =
        token.depth === 2 && /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/.test(token.text)
          ? token.text
          : null;
    }
    if (token.type === "list") {
      for (const item of (token as Tokens.List).items) {
        if (item.raw.includes(needle)) {
          entries.push({ release, raw: item.raw, text: item.text });
        }
      }
    }
  }
  return entries;
}

test("entries with TODO_STACK_APPLY are under version headings, not unreleased prose", () => {
  const entries = findEntryReleases(changelog, "TODO_STACK_APPLY");
  expect(entries.length).toBeGreaterThanOrEqual(2);

  for (const entry of entries) {
    expect(entry.release).not.toBeNull();
  }
});

test("marked entries retain their own version headings and marker text", () => {
  const fixture = `# Changelog

## [2.0.0] - 2026-01-02

### Added

- First entry: \`TODO_STACK_APPLY first\`.

## [1.0.0] - 2026-01-01

### Changed

- Second entry: \`TODO_STACK_APPLY second\`.
`;
  const entries = findEntryReleases(fixture, "TODO_STACK_APPLY");

  expect(entries).toEqual([
    {
      release: "[2.0.0] - 2026-01-02",
      raw: expect.stringContaining("TODO_STACK_APPLY first"),
      text: expect.stringContaining("TODO_STACK_APPLY first"),
    },
    {
      release: "[1.0.0] - 2026-01-01",
      raw: expect.stringContaining("TODO_STACK_APPLY second"),
      text: expect.stringContaining("TODO_STACK_APPLY second"),
    },
  ]);
});
