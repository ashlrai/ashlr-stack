import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const reference = readFileSync(join(root, "docs/site-changelog-source-reference.md"), "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const title = "- **`stack apply` stops attempting to write placeholder secrets.**";

function section(text: string, release: string, subsection: string): string {
  return text.split(`## ${release}\n`)[1]?.split("\n## ")[0]?.split(`### ${subsection}\n`)[1]?.split("\n### ")[0] ?? "";
}

test("the reference locates the same 0.2.1 fix in both source files", () => {
  expect(reference).toContain("../CHANGELOG.md#021-2026-10-16");
  expect(reference).toContain("../packages/site/src/data/CHANGELOG.md#021-2026-10-16");
  expect(reference).toContain("2026-10-16) → Bug fixes");
  expect(reference).toContain("wording differences");

  const copies = paths.map((path) => readFileSync(join(root, path), "utf8"));
  for (const copy of copies) {
    const fixes = section(copy, "0.2.1 (2026-10-16)", "Bug fixes");
    expect(fixes.trimStart().startsWith(title)).toBe(true);
    expect(copy.split(title)).toHaveLength(2);
  }
  expect(copies[0]).toBe(copies[1]);
});

test("later context described by the reference is present in each copy", () => {
  for (const path of paths) {
    const copy = readFileSync(join(root, path), "utf8");
    const released = section(copy, "0.3.0 (2026-10-31)", "Changed");
    const unreleased = section(copy, "Unreleased", "Changed");
    expect(released).toContain("After at least one provider succeeds, `stack apply` wiring checks");
    expect(unreleased).toContain("including providers that failed");
    expect(unreleased).toContain("even if the vault is unreadable");
    expect(unreleased).toContain("`--noWire` skips both checks and stubs");
  }
});
