import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-multiple-sections.md"), "utf8");

/** Release (`##`) -> section (`###`) -> entry texts. Empty sections still appear with `[]`. */
function sections(markdown: string): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  let release = "";
  let section = "";
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth === 2) {
      release = token.text;
      section = "";
      out[release] = {};
    } else if (token.type === "heading" && token.depth === 3) {
      section = token.text;
      out[release][section] = [];
    } else if (token.type === "list" && section) {
      out[release][section].push(...token.items.map((item) => item.text));
    }
  }
  return out;
}

test("every entry stays under its own section heading and release", () => {
  expect(sections(fixture)).toEqual({
    Unreleased: {
      Added: ["Unreleased addition one", "Unreleased addition two"],
      Security: ["Unreleased security note"],
    },
    "1.2.0 (2026-05-01)": {
      Added: ["Added in 1.2.0"],
      Changed: ["Changed in 1.2.0 (first)", "Changed in 1.2.0 (second)"],
      Deprecated: [],
      Removed: ["Removed in 1.2.0"],
      Fixed: ["Fixed in 1.2.0"],
      Security: ["Security in 1.2.0"],
    },
    "1.1.0 (2026-04-01)": {
      Changed: ["Changed in 1.1.0"],
      Fixed: ["Fixed in 1.1.0"],
    },
  });
});

test("an empty section does not pass its neighbours' entries along", () => {
  const release = sections(fixture)["1.2.0 (2026-05-01)"];
  expect(release.Deprecated).toEqual([]);
  expect(release.Changed).not.toContain("Removed in 1.2.0");
  expect(release.Removed).toEqual(["Removed in 1.2.0"]);
});

test("sections keep their file order within a release", () => {
  expect(Object.keys(sections(fixture)["1.2.0 (2026-05-01)"])).toEqual([
    "Added",
    "Changed",
    "Deprecated",
    "Removed",
    "Fixed",
    "Security",
  ]);
});

test("a section name shared by several releases never leaks entries between them", () => {
  for (const [release, byName] of Object.entries(sections(fixture))) {
    if (release === "Unreleased") continue;
    const version = release.split(" ")[0];
    for (const [name, items] of Object.entries(byName)) {
      for (const item of items) expect(item).toContain(`${name} in ${version}`);
    }
  }
});
