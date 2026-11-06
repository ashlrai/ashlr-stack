import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const HEADING = /^\[?(\d+\.\d+\.\d+)\]?(?:\s*(?:—|-|\()\s*(\d{4}-\d{2}-\d{2})\)?)?$/;

/** Each `##` version heading with its `###` section names and top-level list entries. */
function parse(markdown: string): { version: string; date: string | null; sections: string[]; entries: string[] }[] {
  const out: ReturnType<typeof parse> = [];
  let current: (typeof out)[number] | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      const match = token.depth === 2 ? HEADING.exec(token.text) : null;
      current = match ? { version: match[1], date: match[2] ?? null, sections: [], entries: [] } : null;
      if (current) out.push(current);
    } else if (current && token.type === "heading") current.sections.push(token.text);
    else if (current && token.type === "list") current.entries.push(...token.items.map((i: { text: string }) => i.text));
  }
  return out;
}

test("heading-one-entry fixture parses to its version, date, section and entry", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-heading-one-entry.md"), "utf8");
  expect(parse(fixture)).toEqual([
    {
      version: "0.5.0",
      date: "2026-11-02",
      sections: ["Fixed"],
      entries: ["Single fixed entry under a dated version heading."],
    },
  ]);
});

test("a non-version heading is not parsed as a release", () => {
  expect(parse("# Changelog\n\n## Unreleased\n\n- pending\n")).toEqual([]);
});
