import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

/** Each list item mapped to the `##` and `###` headings it sits under (null when absent). */
function owners(markdown: string): { entry: string; version: string | null; section: string | null }[] {
  const found: { entry: string; version: string | null; section: string | null }[] = [];
  let version: string | null = null;
  let section: string | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      version = token.depth === 2 ? token.text : null;
      section = null;
    } else if (token.type === "heading" && token.depth === 3) {
      section = token.text;
    } else if (token.type === "list") {
      for (const item of token.items) found.push({ entry: item.text, version, section });
    }
  }
  return found;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-then-populated.md"), "utf8");

test("an entry after an empty section stays under its own heading", () => {
  expect(owners(fixture)).toEqual([
    { entry: "Populated entry under Fixed.", version: "0.3.0 (2026-04-25)", section: "Fixed" },
    { entry: "Populated entry under 0.1.0 Added.", version: "0.1.0 (2026-04-19)", section: "Added" },
  ]);
});

test("empty sections and empty releases own no entries", () => {
  const sections = owners(fixture).map((o) => `${o.version}/${o.section}`);
  expect(sections).not.toContain("0.3.0 (2026-04-25)/Added");
  expect(owners(fixture).some((o) => o.version === "0.2.0 (2026-04-23)" || o.version === null)).toBe(false);
});

test("CRLF line endings keep the same ownership", () => {
  expect(owners(fixture.replace(/\n/g, "\r\n"))).toEqual(owners(fixture));
});
