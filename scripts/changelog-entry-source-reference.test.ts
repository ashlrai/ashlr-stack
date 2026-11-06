import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const reference = readFileSync(join(root, "docs/changelog-entry-source-reference.md"), "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const release = "0.2.1 (2026-10-16)";
const title = "- **`stack apply` stops attempting to write placeholder secrets.**";

test("reference links to the release and describes the heading-based route", () => {
  for (const path of paths) {
    expect(reference).toContain(`](../${path}#021-2026-10-16)`);
  }
  expect(reference).toContain(`${release} → Bug fixes`);
  expect(reference).toMatch(/first\s+bullet/);
  expect(reference).toContain("other releases and the earlier");
});

test("the first bug fix in that release is the same entry in both files", () => {
  const entries = paths.map((path) => {
    const text = readFileSync(join(root, path), "utf8");
    const section = text.split(`## ${release}\n`)[1]?.split("\n## ")[0];
    const fixes = section?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
    expect(fixes?.trimStart().startsWith(title)).toBe(true);
    const matches = fixes?.split("\n").filter((line) => line.startsWith(title)) ?? [];
    expect(matches).toHaveLength(1);
    return matches[0];
  });
  expect(entries[0]).toBe(entries[1]);
});
