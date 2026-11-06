import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const guide = readFileSync(join(root, "docs/changelog-source-locations.md"), "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const entries = [
  ["Unreleased", "unreleased", "Changed", "`stack apply` does not create placeholder secrets."],
  ["0.3.0 (2026-10-31)", "030-2026-10-31", "Changed and fixed", "Apply wiring checks"],
  ["0.3.0 (2026-10-31)", "030-2026-10-31", "Changed", "`stack apply` wiring checks"],
  ["0.2.2 (2026-10-25)", "022-2026-10-25", "Bug fixes", "`stack apply` with a missing recipe"],
  ["0.2.2 (2026-10-25)", "022-2026-10-25", "Bug fixes", "`stack apply` and `stack init --template`"],
  ["0.2.1 (2026-10-16)", "021-2026-10-16", "Bug fixes", "`stack apply` stops attempting to write placeholder secrets."],
  ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "010--2026-04-19-superseded-by-011", "AI recommendation layer — `stack recommend` + `stack apply`", "`stack apply [recipe-id]`"],
];

test("guide links to both sources and gives a reproducible search", () => {
  for (const path of paths) {
    expect(guide).toContain(`](../${path})`);
    expect(guide).toContain(path);
  }
  expect(guide).toContain("rg -n -F 'stack apply' CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  expect(guide).toContain("Apply wiring");
});

test("linked release and subsection routes contain the documented entries in both sources", () => {
  for (const path of paths) {
    const changelog = readFileSync(join(root, path), "utf8");
    for (const [release, anchor, subsection, entry] of entries) {
      expect(guide).toContain(`](../${path}#${anchor})`);
      const releaseSection = changelog.split(`## ${release}\n`)[1]?.split("\n## ")[0];
      const section = releaseSection?.split(`### ${subsection}\n`)[1]?.split("\n### ")[0];
      expect(section).toContain(entry);
    }
  }
});
