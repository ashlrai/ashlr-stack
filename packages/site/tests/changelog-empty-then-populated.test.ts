import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

type Section = { name: string; items: string[] };
type Release = { heading: string; sections: Section[] };

/** Every `##` heading (Unreleased included) with its `###` sections and their list items. */
function parse(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: Section | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      section = null;
      release = token.depth === 2 ? { heading: token.text, sections: [] } : null;
      if (release) releases.push(release);
    } else if (token.type === "heading" && token.depth === 3 && release) {
      section = { name: token.text, items: [] };
      release.sections.push(section);
    } else if (token.type === "list" && section) {
      for (const item of token.items) section.items.push(item.text);
    }
  }
  return releases;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-then-populated.md"), "utf8");

test("a populated entry stays under its own heading after an empty section", () => {
  const [unreleased] = parse(fixture);
  expect(unreleased.sections).toEqual([
    { name: "Added", items: [] },
    { name: "Fixed", items: ["Populated entry belongs to Fixed, not to the empty Added above it."] },
  ]);
});

test("an empty last section does not leak into the next release", () => {
  const [, v2, v1] = parse(fixture);
  expect(v2.sections).toEqual([
    { name: "Changed", items: ["Changed entry stays under Changed."] },
    { name: "Removed", items: [] },
  ]);
  expect(v1.sections).toEqual([
    { name: "Added", items: ["Entry after an empty Removed in the previous version stays under 0.1.0 Added."] },
  ]);
});
