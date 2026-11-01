import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const map = readFileSync(join(root, "docs/changelog-apply-source-map.md"), "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const release = "0.2.1 (2026-10-16)";
const entry = "- **`stack apply` stops attempting to write placeholder secrets.**";

test("source map links each copy and records its exact headings and entry", () => {
  for (const path of paths) {
    const row = map.split("\n").find((line) => line.includes(`](../${path}#021-2026-10-16)`));
    expect(row).toBeDefined();
    expect(row).toContain(`\`${release}\``);
    expect(row).toContain("`Bug fixes`");
    expect(row).toContain(entry.slice(2));
  }
});

test("both linked release sections contain the same first bug fix", () => {
  const entries = paths.map((path) => {
    const changelog = readFileSync(join(root, path), "utf8");
    const releases = changelog.split(`## ${release}\n`);
    expect(releases).toHaveLength(2);
    const releaseSection = releases[1].split("\n## ")[0];
    const fixSections = releaseSection.split("### Bug fixes\n");
    expect(fixSections.length).toBeGreaterThanOrEqual(2);
    const fixes = fixSections[1].split("\n### ")[0].trimStart();
    const firstBullet = fixes.split("\n")[0];
    expect(firstBullet.startsWith(entry)).toBe(true);
    expect(changelog.split("\n").filter((line) => line.startsWith(entry))).toHaveLength(1);
    return firstBullet;
  });
  expect(entries[0]).toBe(entries[1]);
});
