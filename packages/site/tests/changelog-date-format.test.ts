import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");

/**
 * Date tokens carried by `##` version headings, in either style
 * (`## 0.3.0 (2026-10-31)` or `## [0.2.0] — 2026-04-23`). `## Unreleased`,
 * the `#` title and `###` section headings are not versions, and neither are
 * prerelease headings such as `## 0.4.0-beta.1`.
 */
function versionHeadingDates(markdown: string): { heading: string; dates: string[] }[] {
  const releases: { heading: string; dates: string[] }[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type !== "heading" || token.depth !== 2) continue;
    if (!/^\[?\d+\.\d+\.\d+\]?(?:\s|$)/.test(token.text)) continue;
    releases.push({ heading: token.text, dates: token.text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [] });
  }
  return releases;
}

/** True when `date` is a `YYYY-MM-DD` string naming a real Gregorian calendar date. */
function isCalendarDate(date: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/** `heading -> date` pairs whose date token is not a real calendar date. */
function invalidReleaseDates(markdown: string): string[] {
  return versionHeadingDates(markdown).flatMap(({ heading, dates }) =>
    dates.filter((date) => !isCalendarDate(date)).map((date) => `${heading} -> ${date}`),
  );
}

/** Version headings with no `YYYY-MM-DD` token at all (wrong format or undated). */
function undatedReleaseHeadings(markdown: string): string[] {
  return versionHeadingDates(markdown)
    .filter(({ dates }) => dates.length === 0)
    .map(({ heading }) => heading);
}

/** Version headings carrying more than one `YYYY-MM-DD` date token. */
function multiDatedReleaseHeadings(markdown: string): string[] {
  return versionHeadingDates(markdown)
    .filter(({ dates }) => dates.length > 1)
    .map(({ heading }) => heading);
}

test("every dated site changelog version heading uses a real calendar date", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(invalidReleaseDates(published)).toEqual([]);
});

test("every site changelog version heading carries a YYYY-MM-DD date", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(undatedReleaseHeadings(published)).toEqual([]);
});

test("no site changelog version heading carries two dates", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(multiDatedReleaseHeadings(published)).toEqual([]);
});

test("calendar date validation accepts real dates including leap day", () => {
  for (const date of ["2026-10-31", "2026-04-19", "2024-02-29", "2000-02-29", "1999-12-31"]) {
    expect(isCalendarDate(date), date).toBe(true);
  }
});

test("calendar date validation rejects impossible and malformed dates", () => {
  const invalid = [
    "2026-02-29",
    "2100-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-01-00",
    "2026-1-1",
    "2026-10-31x",
    "26-10-31",
    "2026/10/31",
    "",
  ];
  for (const date of invalid) {
    expect(isCalendarDate(date), date).toBe(false);
  }
});

test("release date extraction reads both heading styles", () => {
  const markdown = [
    "## 0.3.0 (2026-10-31)",
    "",
    "## [0.2.0] — 2026-04-23",
    "",
    "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)",
    "",
  ].join("\n");
  expect(versionHeadingDates(markdown).map(({ dates }) => dates)).toEqual([
    ["2026-10-31"],
    ["2026-04-23"],
    ["2026-04-19"],
  ]);
});

test("release date extraction skips non-version headings", () => {
  const markdown = [
    "# Changelog",
    "",
    "## Unreleased",
    "",
    "### 2026-10-31 notes",
    "",
    "## v0.4.0 (2026-11-01)",
    "",
    "## 0.4.0-beta.1 (2026-11-01)",
    "",
    "## 0.3.0 (2026-10-31)",
    "",
    "```md",
    "## 9.9.9 (2026-99-99)",
    "```",
    "",
  ].join("\n");
  expect(versionHeadingDates(markdown)).toEqual([
    { heading: "0.3.0 (2026-10-31)", dates: ["2026-10-31"] },
  ]);
});

test("release date checks flag impossible, malformed and missing dates", () => {
  expect(invalidReleaseDates("## 0.4.0 (2026-10-31)\n")).toEqual([]);
  expect(invalidReleaseDates("## 0.4.0 (2026-02-30)\n")).toEqual([
    "0.4.0 (2026-02-30) -> 2026-02-30",
  ]);
  expect(invalidReleaseDates("## [0.4.0] — 2026-13-40\n")).toEqual([
    "[0.4.0] — 2026-13-40 -> 2026-13-40",
  ]);
  expect(undatedReleaseHeadings("## 0.4.0\n")).toEqual(["0.4.0"]);
  expect(undatedReleaseHeadings("## 0.4.0 (October 31, 2026)\n")).toEqual([
    "0.4.0 (October 31, 2026)",
  ]);
  expect(undatedReleaseHeadings("## 0.4.0 (2026-10-311)\n")).toEqual(["0.4.0 (2026-10-311)"]);
});

test("duplicate date detection flags version headings with two dates", () => {
  // One date per heading passes in either style, including a superseded-by note.
  expect(multiDatedReleaseHeadings("## 0.3.0 (2026-10-31)\n")).toEqual([]);
  expect(multiDatedReleaseHeadings("## [0.2.0] — 2026-04-23\n")).toEqual([]);
  expect(multiDatedReleaseHeadings("## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n")).toEqual([]);

  // Two date tokens on one version heading are rejected, whichever style.
  expect(multiDatedReleaseHeadings("## 0.4.0 (2026-10-31) (2026-11-01)\n")).toEqual([
    "0.4.0 (2026-10-31) (2026-11-01)",
  ]);
  expect(multiDatedReleaseHeadings("## [0.4.0] — 2026-10-31 — 2026-11-01\n")).toEqual([
    "[0.4.0] — 2026-10-31 — 2026-11-01",
  ]);
  // Repeating the same date is still a duplicate.
  expect(multiDatedReleaseHeadings("## 0.4.0 (2026-10-31) (2026-10-31)\n")).toEqual([
    "0.4.0 (2026-10-31) (2026-10-31)",
  ]);
  // A stray second date mid-heading counts too.
  expect(
    multiDatedReleaseHeadings("## 0.4.0 — 2026-10-31 (supersedes 0.3.0 from 2026-10-01)\n"),
  ).toEqual(["0.4.0 — 2026-10-31 (supersedes 0.3.0 from 2026-10-01)"]);

  // Non-version headings are ignored; every offender is reported in file order.
  expect(
    multiDatedReleaseHeadings(
      [
        "## Unreleased — 2026-11-01 — 2026-11-02",
        "",
        "### 0.4.0 2026-10-31 2026-11-01",
        "",
        "## 0.4.0 (2026-10-31) (2026-11-01)",
        "",
        "## 0.3.0 (2026-10-30)",
        "",
        "## 0.2.0 — 2026-04-23 / 2026-04-24",
        "",
      ].join("\n"),
    ),
  ).toEqual(["0.4.0 (2026-10-31) (2026-11-01)", "0.2.0 — 2026-04-23 / 2026-04-24"]);
});

/** Release headings whose date is later than the release listed above them (newest first). */
function outOfOrderReleaseHeadings(markdown: string): string[] {
  const dated = versionHeadingDates(markdown).filter(({ dates }) => dates.length === 1);
  const flagged: string[] = [];
  for (let i = 1; i < dated.length; i++) {
    if (dated[i].dates[0] > dated[i - 1].dates[0]) flagged.push(dated[i].heading);
  }
  return flagged;
}

test("site changelog releases are listed newest first", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(outOfOrderReleaseHeadings(published)).toEqual([]);
});

test("release order check flags a release dated after the one above it", () => {
  expect(
    outOfOrderReleaseHeadings("## 0.3.0 (2026-10-31)\n\n## 0.2.0 (2026-10-16)\n\n## 0.1.0 (2026-10-17)\n"),
  ).toEqual(["0.1.0 (2026-10-17)"]);
  expect(outOfOrderReleaseHeadings("## 0.2.0 (2026-10-31)\n\n## 0.1.0 (2026-10-31)\n")).toEqual([]);
});


test("Original PR 539: malformed calendar date in a version heading is rejected while a valid date is accepted", () => {
  // Focused: one valid and one impossible date, side by side in the same markdown.
  const markdown = [
    "## 0.5.0 (2026-11-02)",       // valid — November 2 is a real date
    "",
    "## 0.4.0 (2026-02-30)",        // impossible — February never has a 30th
    "",
  ].join("\n");
  // Valid date passes through cleanly (no invalid entries).
  expect(invalidReleaseDates("## 0.5.0 (2026-11-02)\n")).toEqual([]);
  // Impossible date is caught and reported with its heading.
  expect(invalidReleaseDates(markdown)).toEqual(["0.4.0 (2026-02-30) -> 2026-02-30"]);
});
