import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

// Each placeholder-writing `stack apply` change, its release and subsection,
// and the heading both copies must carry. A bold-titled bullet's heading is
// the bold span; an untitled bullet's heading is its first sentence.
const placeholderChanges = [
  ["Unreleased", "Changed", "`stack apply` does not create placeholder secrets."],
  ["0.2.1 (2026-10-16)", "Bug fixes", "**`stack apply` stops attempting to write placeholder secrets.**"],
] as const;

function section(changelog: string, release: string, subsection: string): string {
  const body = changelog.split(`## ${release}\n`)[1]?.split("\n## ")[0] ?? "";
  return body.split(`### ${subsection}\n`)[1]?.split("\n### ")[0] ?? "";
}

function placeholderHeadings(changelog: string): string[] {
  return placeholderChanges.map(([release, subsection]) => {
    const bullets = section(changelog, release, subsection)
      .split("\n")
      .filter((line) => line.startsWith("- ") && line.includes("placeholder secrets"));
    expect(bullets, `${release} → ${subsection}`).toHaveLength(1);
    const heading = bullets[0].slice(2).match(/^\*\*[^*]+\*\*|^[^.]+\./)?.[0];
    expect(heading).toBeDefined();
    return heading as string;
  });
}

function expectMatchingHeadings(source: string, site: string): void {
  const sourceHeadings = placeholderHeadings(source);
  const siteHeadings = placeholderHeadings(site);
  expect(sourceHeadings).toEqual(placeholderChanges.map(([, , heading]) => heading));
  expect(siteHeadings).toEqual(sourceHeadings);
}

const changelogs = paths.map((path) => readFileSync(join(import.meta.dir, "..", path), "utf8"));

test("each placeholder-writing change has the same heading in both changelogs", () => {
  expectMatchingHeadings(changelogs[0], changelogs[1]);
});

test("heading comparison allows different surrounding prose", () => {
  const prose = "wiring checks secret names for every provider in the recipe, including providers that failed";
  expect(changelogs[1]).toContain(prose);
  expectMatchingHeadings(changelogs[0], changelogs[1].replace(prose, "Site-specific explanation."));
});

test("heading comparison rejects missing, duplicate, or different headings in either copy", () => {
  for (const [, , heading] of placeholderChanges) {
    const wrong = heading.replace(/does not create|stops attempting to write/, "still writes");
    for (const index of [0, 1] as const) {
      const bullet = changelogs[index].split("\n").find((line) => line.startsWith(`- ${heading}`));
      expect(bullet).toBeDefined();
      for (const replacement of ["", `${bullet}\n${bullet}`, bullet!.replace(heading, wrong)]) {
        const changed = [...changelogs] as [string, string];
        changed[index] = changed[index].replace(bullet!, replacement);
        expect(() => expectMatchingHeadings(changed[0], changed[1])).toThrow();
      }
    }
    // Rewording the heading in both copies at once is still drift.
    const changed = changelogs.map((changelog) => changelog.replace(heading, wrong));
    expect(() => expectMatchingHeadings(changed[0], changed[1])).toThrow();
  }
});
