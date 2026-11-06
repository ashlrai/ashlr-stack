import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-section-ordering.md"), "utf8");

/** Bullet text per `###` section, in the order the parser returns them. */
function bySection(markdown: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current = "";
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth === 3) out[(current = t.text)] = [];
    else if (t.type === "list" && current) out[current].push(...t.items.map((i: { text: string }) => i.text));
  }
  return out;
}

test("each section keeps its entries in source order with exact text", () => {
  expect(bySection(fixture)).toEqual({
    Added: [
      "Yankee: first in Added, sorts late.",
      "Bravo `--opt` entry, second in Added.",
      "Bravo `--opt` entry, second in Added.",
      "Alpha: last in Added, sorts first.",
    ],
    Fixed: [
      "9th item listed first, sorts after 10th.",
      "10th item listed second.",
      'Zulu & <Angle> "quoted" entry, third.',
    ],
  });
});

test("order is not sorted and duplicate entries are not collapsed", () => {
  for (const entries of Object.values(bySection(fixture))) {
    expect(entries).not.toEqual([...entries].sort());
  }
  expect(bySection(fixture).Added).toHaveLength(4);
});

test("CRLF line endings give the same ordering", () => {
  expect(bySection(fixture.replace(/\n/g, "\r\n"))).toEqual(bySection(fixture));
});
