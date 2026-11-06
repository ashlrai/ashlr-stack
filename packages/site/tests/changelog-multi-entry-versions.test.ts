import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order; entries from every `###` subsection stay with their version. */
function parse(markdown: string): { heading: string; entries: string[] }[] {
  const out: { heading: string; entries: string[] }[] = [];
  let current: { heading: string; entries: string[] } | null = null;
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth <= 2) {
      current = t.depth === 2 && VERSION.test(t.text) ? { heading: t.text, entries: [] } : null;
      if (current) out.push(current);
    } else if (current && t.type === "list") {
      for (const item of t.items) current.entries.push(item.text);
    }
  }
  return out;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-multi-entry-versions.md"), "utf8");

test("every version keeps all of its entries, across subsections, in source order", () => {
  expect(parse(fixture)).toEqual([
    { heading: "1.2.0 (2026-06-03)", entries: ["Alpha feature.", "Beta feature.", "Gamma fix."] },
    { heading: "[1.1.0] — 2026-05-20", entries: ["Delta change."] },
    { heading: "1.0.0 (2026-05-01)", entries: ["Epsilon change.", "Zeta change.", "Eta change."] },
  ]);
});

test("the Unreleased section is skipped and its entry does not leak into a version", () => {
  expect(parse(fixture).flatMap((v) => v.entries)).not.toContain("Not released yet.");
});
