import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs module without type declarations
import { parseLatestRelease } from "./freshness/lib.mjs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const fixture = read("./__fixtures__/changelog/unicode-latest-release.md");
const changelog = read("../CHANGELOG.md");

const UNICODE = [
  "café",
  "résumé naïve",
  "日本語のテキスト",
  "한국어",
  "العربية",
  "Ελληνικά",
  "🚀",
  "👨‍👩‍👧",
  "🇯🇵",
  "e + ◌́ = é",
];

test("parser keeps accented characters and emoji in the fixture entry", () => {
  const release = parseLatestRelease(fixture);
  expect(release.heading).toBe("9.0.0 (2026-11-01)");
  for (const text of UNICODE) expect(release.entry).toContain(text);
  expect(release.entry).not.toContain("�");
});

test("entry parsed from CHANGELOG.md is a verbatim slice of the source", () => {
  const release = parseLatestRelease(changelog);
  expect(release.entry.length).toBeGreaterThan(0);
  expect(changelog.replace(/\r\n?/g, "\n")).toContain(release.entry);
});

test("an injected Unicode release becomes the latest entry in CHANGELOG.md text", () => {
  const injected = fixture.slice(fixture.indexOf("## 9.0.0"));
  const text = changelog.replace("## Unreleased", `${injected}\n## Unreleased`);
  const release = parseLatestRelease(text);
  expect(release.version).toBe("9.0.0");
  for (const t of UNICODE) expect(release.entry).toContain(t);
  expect(release.entry).not.toContain("## Unreleased");
});

// Entries inside one section keep source order and exact text (no sorting, no deduping).
const ordered = read("./__fixtures__/changelog/multi-entry-order.md");

test("entries in one section keep source order and text", () => {
  const release = parseLatestRelease(ordered);
  expect(release.heading).toBe("3.0.0 (2026-11-02)");
  const bullets = release.entry.split("\n").filter((l: string) => l.startsWith("- "));
  expect(bullets).toEqual([
    "- Zulu entry is listed first, so it must stay first despite sorting last.",
    "- Alpha entry has `inline code`, a [link](https://example.com/alpha) and **bold** text.",
    "- Mike entry wraps onto a second line",
    "- Alpha entry has `inline code`, a [link](https://example.com/alpha) and **bold** text.",
    "- Bravo entry in the second subsection stays after every Added entry.",
  ]);
  expect(release.entry).toContain("- Mike entry wraps onto a second line\n  and keeps its indented continuation.\n");
  expect(release.entry).not.toContain("Older release entry");
});

test("entry order survives CRLF line endings", () => {
  expect(parseLatestRelease(ordered.replace(/\n/g, "\r\n"))).toEqual(parseLatestRelease(ordered));
});
