import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const expectedHeading = "`stack apply` stops attempting to write placeholder secrets.";

function applyHeading(changelog: string): string | undefined {
  const release = changelog.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
  const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0] ?? "";
  const headings = [...fixes.matchAll(/^- \*\*(`stack apply`[^*]*)\*\*/gm)].map((match) => match[1]);
  expect(headings).toHaveLength(1);
  return headings[0];
}

function expectMatchingApplyHeadings(source: string, site: string): void {
  const sourceHeading = applyHeading(source);
  const siteHeading = applyHeading(site);
  expect(sourceHeading).toBe(expectedHeading);
  expect(siteHeading).toBe(sourceHeading);
}

const changelogs = paths.map((path) => readFileSync(join(import.meta.dir, "..", path), "utf8"));

test("apply placeholder-removal entry has the same heading in both changelogs", () => {
  expectMatchingApplyHeadings(changelogs[0], changelogs[1]);
});

test("heading comparison allows different surrounding prose", () => {
  const prose = "The wiring step never writes to the vault or fills in missing values.";
  expect(changelogs[1]).toContain(prose);
  expectMatchingApplyHeadings(changelogs[0], changelogs[1].replace(prose, "Site-specific explanation."));
});

test("heading comparison rejects missing, duplicate, or different headings in either copy", () => {
  const heading = `- **${expectedHeading}**`;
  for (const index of [0, 1]) {
    expect(changelogs[index]).toContain(heading);
    for (const replacement of ["", `${heading}\n${heading}`, "- **`stack apply` creates placeholder secrets.**"]) {
      const changed = [...changelogs];
      changed[index] = changed[index].replace(heading, replacement);
      expect(() => expectMatchingApplyHeadings(changed[0], changed[1])).toThrow();
    }
  }
  const changed = changelogs.map((changelog) =>
    changelog.replace(heading, "- **`stack apply` creates placeholder secrets.**"),
  );
  expect(() => expectMatchingApplyHeadings(changed[0], changed[1])).toThrow();
});
