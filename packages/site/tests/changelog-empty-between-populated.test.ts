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

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-between-populated.md"), "utf8");

test("entries stay under their own heading when empty sections sit between populated ones", () => {
  const [unreleased, v2] = parse(fixture);
  expect(unreleased.sections).toEqual([
    { name: "Added", items: ["Added entry one.", "Added entry two,\ncontinued on a second line."] },
    { name: "Changed", items: [] },
    { name: "Fixed", items: ["Fixed entry sits after an empty Changed."] },
    { name: "Deprecated", items: [] },
    { name: "Removed", items: [] },
    { name: "Security", items: ["Security entry follows two consecutive empty sections."] },
  ]);
  expect(v2.sections).toEqual([
    { name: "Added", items: ["Release entry before an empty section."] },
    { name: "Documentation", items: [] },
    { name: "Fixed", items: ["Release entry after an empty section."] },
  ]);
});

test("the empty sections do not change which releases exist", () => {
  expect(parse(fixture).map((r) => r.heading)).toEqual(["Unreleased", "0.2.0 (2026-04-23)"]);
});

test("removing the empty sections leaves every entry under the same heading", () => {
  const stripped = fixture.replace(/### (?:Changed|Deprecated|Removed|Documentation)\n\n/g, "");
  const populated = (rs: Release[]) =>
    rs.map((r) => ({ ...r, sections: r.sections.filter((s) => s.items.length > 0) }));
  expect(populated(parse(stripped))).toEqual(populated(parse(fixture)));
  expect(parse(stripped)[0].sections.map((s) => s.name)).toEqual(["Added", "Fixed", "Security"]);
});
