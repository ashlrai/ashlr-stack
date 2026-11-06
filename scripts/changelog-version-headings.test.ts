import { describe, expect, test } from "bun:test";
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


// Accepted release headings (all forms already used in CHANGELOG.md):
//   ## Unreleased
//   ## 0.3.0 (2026-10-31)
//   ## [0.2.0] — 2026-04-23
//   ## 0.1.1 — 2026-04-19
//   ## 0.1.0 — 2026-04-19 (superseded by 0.1.1)
const SEMVER = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?`;
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const VERSION_HEADING = new RegExp(
  `^## (?:\\[(${SEMVER})\\]|(${SEMVER}))(?: — (${DATE})(?: \\([^()]+\\))?| \\((${DATE})\\))$`,
);

export function checkChangelogHeadings(changelog: string): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let index = 0;
  for (const [i, line] of changelog.split("\n").entries()) {
    if (!/^## /.test(line)) continue;
    const where = `line ${i + 1}: "${line}"`;
    const first = index++ === 0;
    if (line === "## Unreleased") {
      if (!first) problems.push(`${where} — "Unreleased" must be the first release heading`);
      continue;
    }
    const match = VERSION_HEADING.exec(line);
    if (!match) {
      problems.push(`${where} — malformed; expected "## X.Y.Z (YYYY-MM-DD)" or "## Unreleased"`);
      continue;
    }
    const version = match[1] ?? match[2];
    const date = match[3] ?? match[4];
    if (seen.has(version)) problems.push(`${where} — duplicate version ${version}`);
    seen.add(version);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      problems.push(`${where} — invalid date ${date}`);
    }
  }
  if (index === 0) problems.push("no '## ' release headings found");
  return problems;
}

const changelog = readFileSync(join(import.meta.dir, "..", "CHANGELOG.md"), "utf8");

describe("CHANGELOG.md version headings", () => {
  test("every release heading is well formed", () => {
    const problems = checkChangelogHeadings(changelog);
    expect(problems, `Malformed CHANGELOG.md headings:\n${problems.join("\n")}`).toEqual([]);
  });

  test("accepts every heading style in use", () => {
    const ok = [
      "## Unreleased",
      "## 0.3.0 (2026-10-31)",
      "## [0.2.0] — 2026-04-23",
      "## 0.1.1 — 2026-04-19",
      "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)",
    ].join("\n\n");
    expect(checkChangelogHeadings(ok)).toEqual([]);
  });

  test("failure message names the malformed heading and its line", () => {
    const bad = "## Unreleased\n\n## v0.3 (Oct 31)\n\n## 0.2.2 (2026-10-25)\n";
    const problems = checkChangelogHeadings(bad);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('line 3: "## v0.3 (Oct 31)"');
    expect(problems[0]).toContain("malformed");
  });

  test("rejects bad dates, duplicates, and misplaced Unreleased", () => {
    const text = "## 1.0.0 (2026-02-30)\n\n## 1.0.0 (2026-03-01)\n\n## Unreleased\n";
    const joined = checkChangelogHeadings(text).join("\n");
    expect(joined).toContain("invalid date 2026-02-30");
    expect(joined).toContain("duplicate version 1.0.0");
    expect(joined).toContain('must be the first release heading');
  });
});
