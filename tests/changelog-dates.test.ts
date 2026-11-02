import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const changelog = read("../CHANGELOG.md");

/** Version headings: `## 0.3.0 (…)`, `## [0.2.0] — …`, `## Unreleased` is excluded. */
const versionHeadings = (md: string) =>
  md.split("\n").filter((l) => /^## +\[?\d+\.\d+\.\d+/.test(l));
const headings = versionHeadings(changelog);
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

/** True only for real calendar dates (rejects 2026-02-30, 2026-13-01). */
export function isValidDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

test("changelog has version headings", () => {
  expect(headings.length).toBeGreaterThan(0);
});

/** Headings whose date is missing or not a real calendar date. */
function badHeadings(md: string): string[] {
  return versionHeadings(md).filter((h) => {
    const m = DATE.exec(h);
    return !m || !isValidDate(+m[1], +m[2], +m[3]);
  });
}

test("every version heading carries a valid YYYY-MM-DD calendar date", () => {
  expect(badHeadings(changelog)).toEqual([]);
});

test("fixture with a non-leap-year February 29 is rejected", () => {
  const fixture = read("./__fixtures__/changelog-invalid-leap-day.md");
  // Only the 2026-02-29 heading is rejected; the leap-year 2024-02-29 one passes.
  expect(badHeadings(fixture)).toEqual(["## 0.2.0 (2026-02-29)"]);
});

test("heading dates never increase down the file (newest first)", () => {
  const dates = headings.map((h) => (DATE.exec(h) as RegExpExecArray)[0]);
  expect(dates).toEqual([...dates].sort().reverse());
});

test("date validator rejects impossible dates", () => {
  expect(isValidDate(2026, 2, 30)).toBe(false);
  expect(isValidDate(2026, 13, 1)).toBe(false);
  expect(isValidDate(2024, 2, 29)).toBe(true);
  expect(isValidDate(2026, 2, 29)).toBe(false);
});

test("fixture with valid leap-day headings (incl. 2000) is accepted", () => {
  const fixture = read("./__fixtures__/changelog-valid-leap-day.md");
  expect(versionHeadings(fixture)).toHaveLength(3);
  expect(badHeadings(fixture)).toEqual([]);
});

test("non-leap Feb 29 fixtures fail the date validation", () => {
  expect(badHeadings("## 1.0.0 (2026-02-29)\n## 0.9.0 (1900-02-29)")).toHaveLength(2);
});

test("site changelog copy has valid heading dates and matches the root changelog", () => {
  const site = readFileSync(new URL("../packages/site/src/data/CHANGELOG.md", import.meta.url), "utf8");
  expect(badHeadings(site)).toEqual([]);
  expect(site).toBe(changelog);
});
