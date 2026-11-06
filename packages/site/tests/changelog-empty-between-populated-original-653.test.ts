import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

/** Maps `##` heading -> `###` heading -> list items, in document order. */
function parse(markdown: string): Map<string, Map<string, string[]>> {
  const releases = new Map<string, Map<string, string[]>>();
  let sections: Map<string, string[]> | null = null;
  let items: string[] | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      items = null;
      sections = token.depth === 2 ? new Map() : null;
      if (sections) releases.set(token.text, sections);
    } else if (token.type === "heading" && token.depth === 3 && sections) {
      items = [];
      sections.set(token.text, items);
    } else if (token.type === "list" && items) {
      for (const item of token.items) items.push(item.text);
    }
  }
  return releases;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-between-populated-original-653.md"), "utf8");

test("an empty release between populated releases keeps every entry under its own heading", () => {
  const releases = parse(fixture);
  expect([...releases.keys()]).toEqual(["0.3.0 (2026-04-25)", "0.2.0 (2026-04-23)", "0.1.0 (2026-04-19)"]);
  expect(releases.get("0.3.0 (2026-04-25)")).toEqual(
    new Map([["Added", ["Added in 0.3.0."]], ["Fixed", ["Fixed in 0.3.0."]]]),
  );
  expect(releases.get("0.2.0 (2026-04-23)")?.size).toBe(0);
  expect(releases.get("0.1.0 (2026-04-19)")).toEqual(
    new Map([["Added", ["Added in 0.1.0."]], ["Changed", []], ["Fixed", ["Fixed in 0.1.0."]]]),
  );
});

test("an empty release neither absorbs the next release's sections nor leaks the previous one's", () => {
  const empty = parse(fixture).get("0.2.0 (2026-04-23)");
  expect(empty).toBeDefined();
  expect([...empty!.values()].flat()).toEqual([]);
});
