import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

// Release headings are the depth-2 headings of each changelog: "## Unreleased"
// plus one "## <version> ..." per shipped release.
function versionHeadings(changelog: string): string[] {
  return changelog
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
}

// Reports every divergence between the two copies' version headings: headings
// absent from one copy (counted, so a duplicated heading is reported as a
// missing copy) and headings present in both but in a different relative order.
function versionHeadingDrift(source: string, site: string): string[] {
  const drift: string[] = [];
  const [sourceHeadings, siteHeadings] = [versionHeadings(source), versionHeadings(site)];
  const counts = (headings: string[]) => {
    const map = new Map<string, number>();
    for (const heading of headings) map.set(heading, (map.get(heading) ?? 0) + 1);
    return map;
  };
  const [sourceCounts, siteCounts] = [counts(sourceHeadings), counts(siteHeadings)];

  for (const [heading, count] of sourceCounts)
    for (let i = siteCounts.get(heading) ?? 0; i < count; i++)
      drift.push(`missing from packages/site/src/data/CHANGELOG.md: ## ${heading}`);
  for (const [heading, count] of siteCounts)
    for (let i = sourceCounts.get(heading) ?? 0; i < count; i++)
      drift.push(`missing from CHANGELOG.md: ## ${heading}`);

  // Order is checked on the headings present in both copies, first occurrence
  // wins, so headings already reported as missing cannot also flag as reordered.
  const shared = [...new Set(sourceHeadings.filter((heading) => siteCounts.has(heading)))];
  const siteShared = [...new Set(siteHeadings.filter((heading) => sourceCounts.has(heading)))];
  const before = (list: string[], heading: string) => new Set(list.slice(0, list.indexOf(heading)));
  for (const heading of shared) {
    const sourceBefore = before(shared, heading);
    const siteBefore = before(siteShared, heading);
    if (sourceBefore.size !== siteBefore.size || [...sourceBefore].some((other) => !siteBefore.has(other)))
      drift.push(
        `shared heading in a different order: ## ${heading} ` +
          `(release ${shared.indexOf(heading) + 1} of ${shared.length} in CHANGELOG.md, ` +
          `${siteShared.indexOf(heading) + 1} of ${siteShared.length} on the site)`,
      );
  }
  return drift;
}

const changelogs = paths.map((path) => readFileSync(join(import.meta.dir, "..", path), "utf8"));

test("both changelogs list the same version headings in the same order", () => {
  expect(versionHeadingDrift(changelogs[0], changelogs[1])).toEqual([]);
});

test("drift reports a heading missing from either copy", () => {
  const extra = "## 0.4.0 (2026-12-01)\n";
  expect(versionHeadingDrift(`${extra}${changelogs[0]}`, changelogs[1])).toEqual([
    `missing from packages/site/src/data/CHANGELOG.md: ${extra.trim()}`,
  ]);
  expect(versionHeadingDrift(changelogs[0], `${extra}${changelogs[1]}`)).toEqual([
    `missing from CHANGELOG.md: ${extra.trim()}`,
  ]);
});

test("drift reports each extra copy of a duplicated heading", () => {
  const heading = "## 0.3.0 (2026-10-31)\n";
  const doubled = changelogs[1].replace(heading, `${heading}${heading}`);
  expect(versionHeadingDrift(changelogs[0], doubled)).toEqual([`missing from CHANGELOG.md: ${heading.trim()}`]);
});

test("drift reports a retitled shared version as missing from both copies", () => {
  const retitled = changelogs[1].replace("## 0.3.0 (2026-10-31)", "## 0.3.0 (2026-11-01)");
  expect(versionHeadingDrift(changelogs[0], retitled)).toEqual([
    "missing from packages/site/src/data/CHANGELOG.md: ## 0.3.0 (2026-10-31)",
    "missing from CHANGELOG.md: ## 0.3.0 (2026-11-01)",
  ]);
});

test("drift reports both halves of a swapped pair of shared headings", () => {
  const source = "# Changelog\n\n## 0.3.0\n\n## 0.2.0\n\n## 0.1.0\n";
  const site = "# Changelog\n\n## 0.3.0\n\n## 0.1.0\n\n## 0.2.0\n";
  const drift = versionHeadingDrift(source, site);
  expect(drift).toHaveLength(2);
  for (const [heading, sourceRelease, siteRelease] of [
    ["0.1.0", 3, 2],
    ["0.2.0", 2, 3],
  ]) {
    const line = drift.find((entry) => entry.includes(`## ${heading} `));
    expect(line).toContain("shared heading in a different order");
    expect(line).toContain(`release ${sourceRelease} of 3 in CHANGELOG.md`);
    expect(line).toContain(`${siteRelease} of 3 on the site`);
  }
});

test("drift reports the interleaved heading when shared order survives an insertion", () => {
  const source = "# Changelog\n\n## 0.3.0\n\n## 0.2.0\n\n## 0.1.0\n";
  const site = "# Changelog\n\n## 0.3.0\n\n## 0.2.5\n\n## 0.2.0\n\n## 0.1.0\n";
  expect(versionHeadingDrift(source, site)).toEqual(["missing from CHANGELOG.md: ## 0.2.5"]);
});

test("a heading unique to one copy is not double-flagged as reordered", () => {
  const source = "# Changelog\n\n## Unreleased\n\n## 0.3.0\n\n## 0.2.0\n";
  const site = "# Changelog\n\n## 0.3.0\n\n## 0.2.0\n";
  expect(versionHeadingDrift(source, site)).toEqual([
    "missing from packages/site/src/data/CHANGELOG.md: ## Unreleased",
  ]);
});
