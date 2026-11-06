import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs module without type declarations
import { parseLatestRelease } from "./freshness/lib.mjs";

// The latest release is the last section, and the file stops mid-line (no trailing newline).
const fixture = readFileSync(new URL("./__fixtures__/changelog/final-entry-no-newline.md", import.meta.url), "utf8");
const LAST_ITEM = "- Last item has a [link](https://example.com/end) and `code`, no newline after it";

test("fixture really ends mid-line inside the final entry", () => {
  expect(fixture.endsWith("\n")).toBe(false);
  expect(fixture.endsWith("no newline after it")).toBe(true);
});

test("the final entry is returned intact, last character included", () => {
  const release = parseLatestRelease(fixture);
  expect(release.heading).toBe("2.1.0 (2026-10-01)");
  expect(release.entry).toBe(["### Added", "", "- First final-entry item.", LAST_ITEM].join("\n"));
});

test("a trailing newline or CRLF endings do not change the result", () => {
  const expected = parseLatestRelease(fixture);
  expect(parseLatestRelease(`${fixture}\n`)).toEqual(expected);
  expect(parseLatestRelease(fixture.replace(/\n/g, "\r\n"))).toEqual(expected);
});
