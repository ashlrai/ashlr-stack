import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

/** Version → section (### heading) → entries, each in source order. */
function parseSections(markdown: string): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  let version = "";
  let section = "";
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth === 2) {
      version = t.text;
      section = "";
      out[version] = {};
    } else if (version && t.type === "heading" && t.depth === 3) {
      section = t.text;
      out[version][section] = [];
    } else if (version && section && t.type === "list") {
      out[version][section].push(...t.items.map((item) => item.text));
    }
  }
  return out;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-version-two-sections.md"), "utf8");

test("one version with two populated sections keeps each entry under its own section", () => {
  expect(parseSections(fixture)).toEqual({
    "0.5.0 (2026-11-02)": {
      Added: ["Added first.", "Added second."],
      Fixed: ["Fixed first.", "Fixed second."],
    },
  });
});

test("sections and entries come back in source order", () => {
  const sections = parseSections(fixture)["0.5.0 (2026-11-02)"];
  expect(Object.keys(sections)).toEqual(["Added", "Fixed"]);
  expect(Object.values(sections).flat()).toEqual(["Added first.", "Added second.", "Fixed first.", "Fixed second."]);
});
