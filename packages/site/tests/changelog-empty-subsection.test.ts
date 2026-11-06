import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const VERSION = /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/;

type Parsed = { version: string; sections: { name: string; items: string[] }[] };

/** Versions (`##` + semver) with their `###` sections and the list items under each. */
function parse(markdown: string): Parsed[] {
  const versions: Parsed[] = [];
  let version: Parsed | null = null;
  let section: Parsed["sections"][number] | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      section = null;
      version = token.depth === 2 && VERSION.test(token.text) ? { version: token.text, sections: [] } : null;
      if (version) versions.push(version);
    } else if (token.type === "heading" && token.depth === 3 && version) {
      section = { name: token.text, items: [] };
      version.sections.push(section);
    } else if (token.type === "list" && section) {
      for (const item of token.items) section.items.push(item.text);
    }
  }
  return versions;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-subsection.md"), "utf8");

test("empty ### sections create no entries and keep their own section", () => {
  const [v2, v1] = parse(fixture);
  expect(v2.sections.map((s) => s.name)).toEqual(["Added", "Changed", "Fixed"]);
  expect(v2.sections[1].items).toEqual([]);
  expect(v1.sections.map((s) => s.name)).toEqual(["Added", "Removed"]);
  expect(v1.sections[1].items).toEqual([]);
});

test("empty sections do not change the version list or adjacent entries", () => {
  const parsed = parse(fixture);
  expect(parsed.map((v) => v.version)).toEqual(["0.2.0 (2026-04-23)", "0.1.0 (2026-04-19)"]);
  expect(parsed[0].sections[0].items).toEqual(["First added entry.", "Second added entry."]);
  expect(parsed[0].sections[2].items).toEqual(["Fixed entry stays attached to Fixed."]);
  expect(parsed[1].sections[0].items).toEqual(["Initial entry."]);
});

test("removing the empty sections yields identical entries", () => {
  const stripped = fixture.replace(/### (?:Changed|Removed)\n\n?/g, "");
  const nonEmpty = (ps: Parsed[]) =>
    ps.map((v) => ({ ...v, sections: v.sections.filter((s) => s.items.length > 0) }));
  expect(nonEmpty(parse(stripped))).toEqual(nonEmpty(parse(fixture)));
});

test("an empty section at end of file without a newline does not throw", () => {
  expect(parse("## 0.1.0\n\n### Fixed").map((v) => v.sections)).toEqual([[{ name: "Fixed", items: [] }]]);
});
