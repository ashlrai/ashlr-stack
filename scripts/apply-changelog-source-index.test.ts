import { describe, expect, test } from "bun:test";
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

// Folded in from the former apply-changelog-source-map, -version-map and
// -version-reference docs and tests. Scoped to the section so the index table's
// 0.2.1 row above cannot satisfy these checks.
describe("the 0.2.1 placeholder fix section", () => {
  const section = index.split("## The 0.2.1 placeholder fix\n")[1] ?? "";
  const heading = "0.2.1 (2026-10-16)";
  const entry = "- **`stack apply` stops attempting to write placeholder secrets.**";

  test("section exists", () => {
    expect(section.length).toBeGreaterThan(0);
  });

  test("each linked source places the fix under the recorded release, subheading and entry", () => {
    for (const path of paths) {
      const row = section.split("\n").find((line) => line.includes(`](../${path}#021-2026-10-16)`));
      expect(row, `missing version link for ${path}`).toBeDefined();
      expect(row).toContain(`\`${heading}\``);
      expect(row).toContain("`Bug fixes`");
      expect(row).toContain(entry.slice(2));

      const changelog = readFileSync(join(root, path), "utf8");
      const matching = changelog.split(/^## /m).filter((s) => s.includes(entry));
      expect(matching).toHaveLength(1);
      expect(matching[0].startsWith(`${heading}\n`)).toBe(true);
      const fixes = matching[0].split(/^### Bug fixes\n/m)[1]?.split(/^### /m)[0];
      expect(fixes?.trimStart().startsWith(entry)).toBe(true);
    }
  });

  test("both linked release sections contain the same first bug fix", () => {
    const firsts = paths.map((path) => {
      const changelog = readFileSync(join(root, path), "utf8");
      const releases = changelog.split(`## ${heading}\n`);
      expect(releases).toHaveLength(2);
      const fixSections = releases[1].split("\n## ")[0].split("### Bug fixes\n");
      expect(fixSections.length).toBeGreaterThanOrEqual(2);
      const firstBullet = fixSections[1].split("\n### ")[0].trimStart().split("\n")[0];
      expect(firstBullet.startsWith(entry)).toBe(true);
      expect(changelog.split("\n").filter((line) => line.startsWith(entry))).toHaveLength(1);
      return firstBullet;
    });
    expect(firsts[0]).toBe(firsts[1]);
  });

  test("section distinguishes the recorded version from npm publication", () => {
    const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    const release = changelog.split("## 0.2.2 (2026-10-25)\n")[1]?.split("\n## ")[0];
    expect(release).toContain("0.2.1 was tagged but its npm publish failed");
    expect(release).toContain("ships everything listed here and under 0.2.1 below");
    expect(section).toContain("](../CHANGELOG.md#022-2026-10-25)");
    expect(section).toContain("0.2.1 was tagged but its npm publish failed");
    expect(section).toContain("0.2.2 includes its changes");
  });
});
