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

test("marker search excludes an unmarked neighboring entry", () => {
  const markdown = `## 1.0.0

- Apply the change with \`TODO_STACK_APPLY\`.
- Another change without the marker.
`;

  expect(findEntriesWith(markdown, "TODO_STACK_APPLY")).toEqual([
    {
      raw: "- Apply the change with `TODO_STACK_APPLY`.\n",
      text: "Apply the change with `TODO_STACK_APPLY`.",
    },
  ]);
});

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

test("entries with TODO_STACK_APPLY are under version headings, not unreleased prose", () => {
  const entries = findEntriesWith(changelog, "TODO_STACK_APPLY");
  expect(entries.length).toBeGreaterThanOrEqual(2);

  // Walk headings to confirm each entry falls under a version section.
  let release: string | null = null;
  const releases: (string | null)[] = [];
  for (const token of marked.lexer(changelog)) {
    if (token.type === "heading" && token.depth <= 2) {
      release =
        token.depth === 2 && /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/.test(token.text)
          ? token.text
          : null;
    }
    if (token.type === "list") {
      for (const item of (token as Tokens.List).items) {
        if (item.raw.includes("TODO_STACK_APPLY")) {
          releases.push(release);
        }
      }
    }
  }
  // Every entry with the marker should be under a version heading (not null).
  for (const r of releases) {
    expect(r).not.toBeNull();
  }
});
