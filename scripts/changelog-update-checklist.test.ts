import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const checklist = readFileSync(join(root, "docs/changelog-update-checklist.md"), "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

test("checklist identifies both files and requires a historical comparison before sync", () => {
  for (const path of paths) expect(checklist).toContain(`](../${path})`);
  expect(checklist).toContain("corresponding historical entries in full");
  expect(checklist.indexOf("Before editing or syncing")).toBeLessThan(checklist.indexOf("sync-content`"));
  expect(checklist).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  expect(checklist).toContain("site-only changes");
  expect(checklist).toContain("suppresses copy errors");
});

test("checklist examples identify corresponding entries in both histories", () => {
  expect(checklist).toContain("0.1.0 → AI recommendation layer");
  expect(checklist).toContain("0.2.1 →\n  Bug fixes");
  const entries = paths.map((path) => {
    const changelog = readFileSync(join(root, path), "utf8");
    const entry = (release: string, subsection: string, prefix: string) => {
      const section = changelog.split(release)[1]?.split("\n## ")[0]?.split(subsection)[1]?.split("\n### ")[0];
      const matches = section?.split("\n").filter((line) => line.startsWith(prefix)) ?? [];
      expect(matches, path).toHaveLength(1);
      return matches[0];
    };
    return [
      entry("## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n", "### AI recommendation layer", "- **`stack apply [recipe-id]`**"),
      entry("## 0.2.1 (2026-10-16)\n", "### Bug fixes\n", "- **`stack apply` stops attempting to write placeholder secrets."),
    ];
  });
  expect(entries[0]).toEqual(entries[1]);
  expect(entries[0][0]).toContain("Historically, wiring attempted to write");
  expect(entries[0][1]).toContain("The wiring step never writes to the vault");
});
