import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

/** Version headings look like `## 0.3.0 (date)`, `## [0.2.0] — date`, or `## 0.1.1 — date`. */
function versionsOf(changelog: string): string[] {
  return [...changelog.matchAll(/^## \[?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\]?(?=\s|$)/gm)].map((m) => m[1]);
}

/** Returns each version that has more than one heading. */
export function duplicateVersions(changelog: string): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of versionsOf(changelog)) (seen.has(v) ? dupes : seen).add(v);
  return [...dupes];
}

for (const path of paths) {
  const text = readFileSync(join(import.meta.dir, "..", path), "utf8");

  test(`${path} has at least one version heading and no duplicates`, () => {
    expect(versionsOf(text).length).toBeGreaterThan(0);
    expect(duplicateVersions(text)).toEqual([]);
  });

  test(`${path}: duplicate check fails when a version heading is repeated`, () => {
    const [first] = versionsOf(text);
    const heading = text.split("\n").find((l) => l.startsWith(`## ${first}`) || l.startsWith(`## [${first}]`))!;
    expect(duplicateVersions(`${text}\n${heading}\n`)).toEqual([first]);
  });
}

test("duplicate check treats bracketed and plain headings as the same version", () => {
  expect(duplicateVersions("## 1.0.0 (x)\n\n## [1.0.0] — y\n")).toEqual(["1.0.0"]);
  expect(duplicateVersions("## 1.0.0\n\n## 1.0.1\n\n## Unreleased\n")).toEqual([]);
});
