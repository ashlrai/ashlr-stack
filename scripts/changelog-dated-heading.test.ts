import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs module without type declarations
import { parseLatestRelease } from "./freshness/lib.mjs";

const fixture = readFileSync(new URL("./__fixtures__/changelog/dated-version-heading.md", import.meta.url), "utf8");

test("returns version, date and entry of the latest dated heading", () => {
  const release = parseLatestRelease(fixture);
  expect(release.version).toBe("1.4.2");
  expect(release.date).toBe("2026-09-15");
  expect(release.heading).toBe("1.4.2 (2026-09-15)");
  expect(release.entry).toContain("- Dated entry body line.");
});

test("entry stops at the next heading and skips Unreleased and fenced headings", () => {
  const { entry } = parseLatestRelease(fixture);
  expect(entry).not.toContain("Not released yet");
  expect(entry).not.toContain("Older entry");
  expect(entry).toContain("## 9.9.9 (2030-01-01)");
});

test("CRLF input parses the same", () => {
  expect(parseLatestRelease(fixture.replace(/\n/g, "\r\n"))).toEqual(parseLatestRelease(fixture));
});

test("returns null without a dated release heading", () => {
  expect(parseLatestRelease("# Changelog\n\n## Unreleased\n")).toBeNull();
});

test("the real CHANGELOG.md has a latest release with an entry", () => {
  const real = parseLatestRelease(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
  expect(real?.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(real?.entry.length).toBeGreaterThan(0);
});
