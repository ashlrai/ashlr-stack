import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const here = import.meta.dir;
const fixture = readFileSync(join(here, "__fixtures__/changelog-distinct-headings.md"), "utf8");

/** `## release / ### section` -> entry texts, in source order. */
function entriesBySection(markdown: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let release = "";
  let key = "";
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth === 2) {
      release = token.text;
      key = release;
      out[key] = [];
    } else if (token.type === "heading" && token.depth === 3) {
      key = `${release} / ${token.text}`;
      out[key] = [];
    } else if (token.type === "list" && key) {
      out[key].push(...token.items.map((item) => item.text.trim()));
    }
  }
  return out;
}

test("entries stay with their own section when headings are distinct and unordered", () => {
  expect(entriesBySection(fixture)).toEqual({
    Unreleased: [],
    "Unreleased / Performance": ["Faster cold start."],
    "Unreleased / Documentation": ["Clearer setup guide.", "New troubleshooting page."],
    "Unreleased / Internal": ["Dropped a dead helper."],
    "0.4.0 (2026-06-01)": [],
    "0.4.0 (2026-06-01) / Documentation": ["Release notes reworded."],
    "0.4.0 (2026-06-01) / Performance": ["Cached vault probes.", "Bounded probe concurrency."],
    "0.4.0 (2026-06-01) / Breaking changes": ["Renamed `--noWire`."],
  });
});

test("the same heading name in two releases keeps separate entries", () => {
  const sections = entriesBySection(fixture);
  expect(sections["Unreleased / Documentation"]).not.toEqual(sections["0.4.0 (2026-06-01) / Documentation"]);
});
