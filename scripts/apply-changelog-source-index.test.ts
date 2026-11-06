import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const index = readFileSync(join(root, "docs/apply-changelog-source-index.md"), "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const entries = [
  ["Unreleased", "unreleased", "Changed", "`stack apply` does not create placeholder secrets."],
  ["0.3.0 (2026-10-31)", "030-2026-10-31", "Changed and fixed", "Apply wiring checks existing secret names"],
  ["0.3.0 (2026-10-31)", "030-2026-10-31", "Changed", "`stack apply` wiring checks"],
  ["0.2.1 (2026-10-16)", "021-2026-10-16", "Bug fixes", "`stack apply` stops attempting to write placeholder secrets."],
  ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "010--2026-04-19-superseded-by-011", "AI recommendation layer — `stack recommend` + `stack apply`", "`stack apply [recipe-id]`"],
];

test("index links both sources and their release headings to the described changes", () => {
  for (const path of paths) {
    expect(index).toContain(`](../${path})`);
    const changelog = readFileSync(join(root, path), "utf8");
    for (const [release, anchor, heading, entry] of entries) {
      const row = index.split("\n").find((line) => line.includes(`](../${path}#${anchor})`));
      expect(row).toBeDefined();
      expect(row).toContain(heading);
      const releaseSection = changelog.split(`## ${release}\n`)[1]?.split("\n## ")[0];
      const subsection = releaseSection?.split(`### ${heading}\n`)[1]?.split("\n### ")[0];
      expect(subsection).toContain(entry);
    }
  }
});

test("index disambiguates the 0.2.1 placeholder fix", () => {
  const row = index.split("\n").find((line) => line.includes("#021-2026-10-16"));
  expect(row).toContain("first Bug fixes");
  expect(row).toContain("First bullet");
  for (const path of paths) {
    const changelog = readFileSync(join(root, path), "utf8");
    const release = changelog.split("## 0.2.1 (2026-10-16)\n")[1].split("\n## ")[0];
    const sections = release.split("### Bug fixes\n");
    expect(sections).toHaveLength(3);
    expect(sections[1].trimStart().startsWith("- **`stack apply` stops attempting to write placeholder secrets.")).toBe(true);
  }
});
