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

// A blank line between entries (a loose list, as in CHANGELOG.md's long entries) keeps every entry, in order.
const loose = read("./__fixtures__/changelog/blank-line-between-entries.md");

test("entries separated by blank lines are all retained in source order", () => {
  const release = parseLatestRelease(loose);
  expect(release.heading).toBe("4.0.0 (2026-11-03)");
  const bullets = release.entry.split("\n").filter((l: string) => l.startsWith("- "));
  expect(bullets).toEqual([
    "- First entry sits alone, followed by one blank line.",
    "- Second entry follows a blank line and keeps `inline code` and a [link](https://example.com/second).",
    "- Third entry follows two blank lines.",
    "- Fourth entry in the next subsection.",
  ]);
  expect(release.entry).toContain("line.\n\n- Second entry");
  expect(release.entry).toContain("\n\n\n- Third entry");
  expect(release.entry).not.toContain("Older release entry");
});

test("blank-line-separated entries survive CRLF line endings", () => {
  expect(parseLatestRelease(loose.replace(/\n/g, "\r\n"))).toEqual(parseLatestRelease(loose));
});

// Per-entry Unicode: parseReleaseEntries splits a Unicode release without altering any code point.
// @ts-expect-error plain .mjs module without type declarations
import { parseReleaseEntries } from "./freshness/lib.mjs";
const multi = read("./__fixtures__/changelog/unicode-multi-entry.md");

test("each Unicode bullet is retained exactly, with its continuation line", () => {
  const release = parseLatestRelease(multi);
  expect(release.heading).toBe("9.1.0 (2026-11-03)");
  expect(parseReleaseEntries(release.entry)).toEqual([
    "- **`stack añadir`** — « guillemets », “curly quotes”, and an em dash — kept verbatim.",
    "- Ключевые слова: Привет, мир; हिन्दी; ไทย; 🧑🏽‍💻 (skin tone + ZWJ).\n  Continuation line keeps ñ and 日本語.",
    "- NFC é (U+00E9) and NFD e + U+0301 stay distinct: é vs é.",
  ]);
  expect(release.entry).not.toContain("Older café entry");
});

test("the parser does not normalize: NFC and NFD forms stay different", () => {
  const entry = parseLatestRelease(multi).entry;
  expect(entry).toContain("é vs é");
  expect(entry.normalize("NFC")).not.toBe(entry);
});

test("Unicode entries survive CRLF line endings", () => {
  const crlf = multi.replace(/\n/g, "\r\n");
  expect(parseLatestRelease(crlf)).toEqual(parseLatestRelease(multi));
  expect(parseReleaseEntries(parseLatestRelease(crlf).entry)).toEqual(
    parseReleaseEntries(parseLatestRelease(multi).entry),
  );
});

test("a Unicode release heading inside a fenced code block is ignored", () => {
  const text = "# Changelog\n\n```md\n## 99.0.0 (2026-12-31)\n- 🚀 not real\n```\n\n" + multi.slice(multi.indexOf("## 9.1.0"));
  const release = parseLatestRelease(text);
  expect(release.version).toBe("9.1.0");
  expect(release.entry).not.toContain("not real");
});
