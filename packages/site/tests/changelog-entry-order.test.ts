import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");

/** Top-level bullet text per `##`/`###` section, in the order the parser returns them. */
function sections(markdown: string): { section: string; entries: string[] }[] {
  const out: { section: string; entries: string[] }[] = [];
  let h2 = "";
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth <= 3) {
      if (t.depth === 2) h2 = t.text;
      out.push({ section: t.depth === 2 ? h2 : `${h2} / ${t.text}`, entries: [] });
    } else if (t.type === "list" && out.length) {
      for (const item of t.items) out[out.length - 1].entries.push(item.text.split("\n")[0].trim());
    }
  }
  return out;
}

test("two entries in one section come back in source order, not sorted", () => {
  const md = "## 1.0.0\n\n### Added\n\n- Zebra entry\n- Apple entry\n";
  expect(sections(md).find((s) => s.section === "1.0.0 / Added")?.entries).toEqual(["Zebra entry", "Apple entry"]);
});

test("entries separated by blank lines keep source order", () => {
  const md = "## 1.0.0\n\n### Fixed\n\n- Second alphabetically\n\n- First alphabetically\n";
  expect(sections(md).find((s) => s.section === "1.0.0 / Fixed")?.entries).toEqual([
    "Second alphabetically",
    "First alphabetically",
  ]);
});

for (const [label, path] of [
  ["root CHANGELOG.md", "CHANGELOG.md"],
  ["site changelog", "packages/site/src/data/CHANGELOG.md"],
] as const) {
  test(`${label}: entries in every section follow their order in the file`, () => {
    const raw = readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
    const lines = raw.split("\n");
    let checked = 0;
    for (const { section, entries } of sections(raw)) {
      if (entries.length < 2) continue;
      // Each entry's first source line must appear after the previous one's.
      let from = 0;
      for (const entry of entries) {
        const at = lines.findIndex((l, i) => i >= from && l.includes(entry.slice(0, 40)));
        expect(at, `${section}: ${entry.slice(0, 40)}`).toBeGreaterThanOrEqual(from);
        from = at + 1;
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
}
