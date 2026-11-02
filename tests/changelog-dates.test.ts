import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

/** Version headings: `## 0.3.0 (…)`, `## [0.2.0] — …`, `## Unreleased` is excluded. */
const headings = changelog.split("\n").filter((l) => /^## +\[?\d+\.\d+\.\d+/.test(l));
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

/** True only for real calendar dates (rejects 2026-02-30, 2026-13-01). */
export function isValidDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

test("changelog has version headings", () => {
  expect(headings.length).toBeGreaterThan(0);
});

test("every version heading carries a valid YYYY-MM-DD calendar date", () => {
  for (const h of headings) {
    const m = DATE.exec(h);
    expect(m, `missing YYYY-MM-DD date: ${h}`).not.toBeNull();
    const [, y, mo, d] = m as RegExpExecArray;
    expect(isValidDate(+y, +mo, +d), `invalid calendar date: ${h}`).toBe(true);
  }
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
