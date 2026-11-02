import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
