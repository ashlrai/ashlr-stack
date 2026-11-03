import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-subsection.md"), "utf8");

type Section = { version: string; name: string; entries: string[] };

/** Every `###` subsection (kept even when empty) with the text of its list entries. */
function parseSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let version = "";
  let current: Section | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      version = token.depth === 2 ? token.text : "";
      current = null;
    } else if (token.type === "heading" && token.depth === 3) {
      current = { version, name: token.text, entries: [] };
      sections.push(current);
    } else if (current && token.type === "list") {
      for (const item of token.items) current.entries.push(item.text);
    }
  }
  return sections;
}

test("empty ### sections are kept with no entries and create no spurious entry", () => {
  const sections = parseSections(fixture);
  expect(sections.map((s) => `${s.version} / ${s.name}`)).toEqual([
    "0.2.0 (2026-04-23) / Added",
    "0.2.0 (2026-04-23) / Changed",
    "0.2.0 (2026-04-23) / Fixed",
    "0.2.0 (2026-04-23) / Removed",
    "0.1.0 (2026-04-19) / Added",
  ]);
  const byName = (v: string, n: string) => sections.find((s) => s.version.startsWith(v) && s.name === n);
  expect(byName("0.2.0", "Changed")?.entries).toEqual([]);
  expect(byName("0.2.0", "Removed")?.entries).toEqual([]);
  expect(sections.flatMap((s) => s.entries)).toHaveLength(4);
});

test("empty sections do not change the entries of adjacent sections", () => {
  const sections = parseSections(fixture);
  expect(sections[0].entries).toEqual(["Added entry one.", "Added entry two."]);
  expect(sections[2].entries).toEqual(["Fixed entry."]);
  expect(sections[4].entries).toEqual(["Initial entry."]);

  // Removing the empty sections leaves every populated section byte-identical.
  const stripped = fixture.replace(/### (?:Changed|Removed)\n\n/g, "");
  expect(parseSections(stripped).filter((s) => s.entries.length > 0)).toEqual(
    sections.filter((s) => s.entries.length > 0),
  );
});
