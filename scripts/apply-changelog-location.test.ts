import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const doc = readFileSync(join(root, "docs/apply-changelog-location.md"), "utf8");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

// [release heading, subheading, bullet opening]
const rows: [string, string, string][] = [
  ["Unreleased", "Changed", "- `stack apply` does not create placeholder secrets."],
  ["0.3.0 (2026-10-31)", "Changed and fixed", "- Apply wiring checks existing secret names without storing placeholders;"],
  ["0.3.0 (2026-10-31)", "Changed", "- After at least one provider succeeds, `stack apply` wiring checks"],
  ["0.2.1 (2026-10-16)", "Bug fixes", "- **`stack apply` stops attempting to write placeholder secrets.**"],
  ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "AI recommendation layer", "- **`stack apply [recipe-id]`**"],
];

function sectionOf(text: string, heading: string): string {
  const section = text.split(/^## /m).find((s) => s.startsWith(`${heading}\n`));
  expect(section, `missing release ${heading}`).toBeDefined();
  return section as string;
}

test("each documented row names its entry in both changelogs", () => {
  for (const source of sources) {
    const text = readFileSync(join(root, source), "utf8");
    for (const [heading, sub, bullet] of rows) {
      const section = sectionOf(text, heading);
      expect(section, `${source} ${heading}`).toContain(bullet);
      // The documented subheading must be a heading that precedes the bullet.
      const before = section.slice(0, section.indexOf(bullet));
      expect(before, `${source} ${heading} / ${sub}`).toMatch(new RegExp(`^### ${sub}`, "m"));
      const lastSub = [...before.matchAll(/^### (.*)$/gm)].pop()?.[1] ?? "";
      expect(lastSub.startsWith(sub), `${source}: ${bullet} is under "${lastSub}"`).toBe(true);
    }
  }
});

test("the doc lists every row and both sources", () => {
  for (const source of sources) expect(doc).toContain(`](../${source})`);
  for (const [heading, sub, bullet] of rows) {
    expect(doc).toContain(`\`${heading}\``);
    expect(doc).toContain(`\`${sub}\``);
    expect(doc).toContain(bullet.replace(/^- /, "").slice(0, 40));
  }
});

test("the entries sit at the same line in both files", () => {
  const [a, b] = sources.map((s) => readFileSync(join(root, s), "utf8").split("\n"));
  for (const [, , bullet] of rows) {
    const at = (lines: string[]) => lines.findIndex((l) => l.startsWith(bullet));
    expect(at(a)).toBeGreaterThan(-1);
    expect(at(a)).toBe(at(b));
  }
});
