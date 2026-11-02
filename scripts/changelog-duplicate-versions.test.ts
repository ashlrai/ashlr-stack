import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const fixturePath = "scripts/__fixtures__/changelog/duplicate-version-headings.md";

/**
 * Version headings look like `## 0.3.0 (date)`, `## [0.2.0] — date`, or
 * `## 0.1.1 — date`. Fenced code blocks are skipped so example headings inside
 * them are not counted as releases.
 */
function versionsOf(changelog: string): string[] {
  const versions: string[] = [];
  let fence: { marker: string; length: number } | undefined;
  for (const line of changelog.split(/\r?\n/)) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        delimiter &&
        delimiter[1][0] === fence.marker &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      ) {
        fence = undefined;
      }
      continue;
    }
    if (delimiter) {
      fence = { marker: delimiter[1][0], length: delimiter[1].length };
      continue;
    }
    const heading = line.match(/^ {0,3}## \[?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\]?(?=\s|$)/);
    if (heading) versions.push(heading[1]);
  }
  return versions;
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
    const heading = text
      .split("\n")
      .find((l) => l.startsWith(`## ${first}`) || l.startsWith(`## [${first}`))!;
    expect(duplicateVersions(`${text}\n${heading}\n`)).toEqual([first]);
  });
}

test("duplicate check treats bracketed and plain headings as the same version", () => {
  expect(duplicateVersions("## 1.0.0 (x)\n\n## [1.0.0] — y\n")).toEqual(["1.0.0"]);
  expect(duplicateVersions("## 1.0.0\n\n## 1.0.1\n\n## Unreleased\n")).toEqual([]);
});

test("fixture changelog has a duplicated version heading the check reports", () => {
  const fixture = readFileSync(join(import.meta.dir, "..", fixturePath), "utf8");
  expect(duplicateVersions(fixture)).toEqual(["0.2.0"]);
});

test("duplicate check ignores example headings inside fenced code blocks", () => {
  const fixture = readFileSync(join(import.meta.dir, "..", fixturePath), "utf8");
  // The fixture shows `## 0.3.0` and `## 0.1.1` examples inside fences; each
  // version has exactly one real heading, so neither may count twice.
  expect(versionsOf(fixture)).toEqual(["0.3.0", "0.2.0", "0.2.0", "0.1.1"]);
});
