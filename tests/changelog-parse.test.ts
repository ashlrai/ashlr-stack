import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  inlineLinks,
  malformedHeadings,
  sectionEntries,
  versionBodies,
  versionSections,
} from "./changelog-parser-utils";

export interface ChangelogVersion {
  /** `null` for `## Unreleased`. */
  version: string | null;
  /** `YYYY-MM-DD`, or `null` for `## Unreleased`. */
  date: string | null;
  /** Bullet entries (`- ` lines) under the version, without the marker. */
  entries: string[];
}

const HEADING = /^## (?:Unreleased|\[?(\d+\.\d+\.\d+)\]?\s+(?:\(|—\s+)(\d{4}-\d{2}-\d{2})\)?.*)$/;

/** Parses level-2 version headings and their bullet entries (fenced code ignored). */
export function parseChangelog(markdown: string): ChangelogVersion[] {
  const out: ChangelogVersion[] = [];
  let fenced = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = HEADING.exec(line);
    if (m) out.push({ version: m[1] ?? null, date: m[2] ?? null, entries: [] });
    else if (/^- /.test(line) && out.length > 0) out[out.length - 1].entries.push(line.slice(2));
  }
  return out;
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("dated version fixture returns version, date and entry for every heading style", () => {
  expect(parseChangelog(read("./__fixtures__/changelog-dated-version.md"))).toEqual([
    { version: null, date: null, entries: ["Pending entry."] },
    { version: "0.3.0", date: "2026-10-31", entries: ["Dated entry for 0.3.0."] },
    { version: "0.2.0", date: "2026-04-23", entries: ["Bracketed entry for 0.2.0."] },
    { version: "0.1.0", date: "2026-04-19", entries: ["Noted entry for 0.1.0."] },
  ]);
});

test("site CHANGELOG.md parses 0.3.0 with its date and entries", () => {
  const site = parseChangelog(read("../packages/site/src/data/CHANGELOG.md"));
  const v030 = site.find((v) => v.version === "0.3.0");
  expect(v030?.date).toBe("2026-10-31");
  expect(v030?.entries.length).toBeGreaterThan(0);
  for (const v of site) if (v.version) expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});


test("site CHANGELOG.md returns a non-empty result with Unreleased and dated versions", () => {
  const site = parseChangelog(read("../packages/site/src/data/CHANGELOG.md"));
  // Parser returns a non-empty array — every version found in the file.
  expect(site.length).toBeGreaterThan(0);
  // First section is Unreleased (no version tag).
  expect(site[0].version).toBe(null);
  expect(site[0].date).toBe(null);
  // At least one dated release follows.
  const dated = site.filter((v) => v.version !== null);
  expect(dated.length).toBeGreaterThan(0);
  // Every dated version has a valid date and at least one entry.
  for (const v of dated) {
    expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.entries.length).toBeGreaterThan(0);
  }
});

test("two-version fixture keeps versions and entries in source order (not sorted)", () => {
  expect(parseChangelog(read("./__fixtures__/changelog-two-version-order.md"))).toEqual([
    {
      version: "0.2.0",
      date: "2026-04-23",
      entries: ["Second entry A for 0.2.0.", "First entry B for 0.2.0.", "Third entry C for 0.2.0."],
    },
    { version: "0.1.0", date: "2026-04-19", entries: ["Entry Z for 0.1.0.", "Entry A for 0.1.0."] },
  ]);
});

test("two-section fixture keeps both sections' entries in source order", () => {
  // "Fixed" precedes "Added" in the source, so alphabetical sorting would fail this.
  expect(parseChangelog(read("./__fixtures__/changelog-two-section-order.md"))).toEqual([
    {
      version: "0.4.0",
      date: "2026-11-03",
      entries: ["Fixed first.", "Fixed second.", "Added first.", "Added second."],
    },
  ]);
});

test("multiple-sections fixture keeps section order and entry membership per version", () => {
  const sections = sectionEntries(read("./__fixtures__/changelog-multiple-sections.md"));
  // Non-alphabetical order, an empty section, and a section name repeated across versions.
  expect(sections).toEqual([
    { version: "## Unreleased", section: "Security", entries: ["Pending security note."] },
    { version: "## Unreleased", section: "Added", entries: ["Pending addition."] },
    { version: "## 0.6.0 (2026-11-03)", section: "Fixed", entries: ["Fixed in 0.6.0."] },
    {
      version: "## 0.6.0 (2026-11-03)",
      section: "Added",
      entries: ["Added in 0.6.0 (first).", "Added in 0.6.0 (second)."],
    },
    { version: "## 0.6.0 (2026-11-03)", section: "Removed", entries: [] },
    { version: "## 0.6.0 (2026-11-03)", section: "Changed", entries: ["Changed in 0.6.0."] },
    { version: "## 0.5.0 (2026-10-01)", section: "Added", entries: ["Added in 0.5.0."] },
    { version: "## 0.5.0 (2026-10-01)", section: "Fixed", entries: ["Fixed in 0.5.0."] },
  ]);
});

test("multiple-sections fixture: version-level parse flattens entries in source order", () => {
  expect(parseChangelog(read("./__fixtures__/changelog-multiple-sections.md"))).toEqual([
    { version: null, date: null, entries: ["Pending security note.", "Pending addition."] },
    {
      version: "0.6.0",
      date: "2026-11-03",
      entries: ["Fixed in 0.6.0.", "Added in 0.6.0 (first).", "Added in 0.6.0 (second).", "Changed in 0.6.0."],
    },
    { version: "0.5.0", date: "2026-10-01", entries: ["Added in 0.5.0.", "Fixed in 0.5.0."] },
  ]);
});

test("inline-code fixture keeps backtick text verbatim in parsed entries", () => {
  expect(parseChangelog(read("./__fixtures__/changelog-inline-code.md"))).toEqual([
    {
      version: "0.5.0",
      date: "2026-11-03",
      entries: [
        "Run `stack apply --noWire` to skip wiring; flags like `--json` stay literal.",
        "Code spans keep markup: `a - b`, `[not a link](x)`, and `## not a heading`.",
      ],
    },
  ]);
});

test("bold-entry fixture keeps ** and __ markers verbatim in parsed entries", () => {
  // Documented representation: entries are raw Markdown, so bold markers are retained, not stripped.
  expect(parseChangelog(read("./__fixtures__/changelog-bold-entry.md"))).toEqual([
    {
      version: "0.7.0",
      date: "2026-11-03",
      entries: [
        "**Bold lead-in:** the rest of the entry.",
        "**Entirely bold entry.**",
        "Plain entry with a **bold** word and `**code, not bold**` inside.",
        "Underscore __bold__ spelling stays as written.",
      ],
    },
    {
      version: "0.6.0",
      date: "2026-11-02",
      entries: ["**Older bold entry** kept under its own version."],
    },
  ]);
});

test("blank-lines fixture returns both entries in order without blank entries", () => {
  const [v] = parseChangelog(read("./__fixtures__/changelog-blank-lines-between-entries.md"));
  expect(v).toEqual({
    version: "0.6.0",
    date: "2026-11-03",
    entries: ["First entry after blank lines.", "Second entry after more blank lines."],
  });
  expect(v.entries.every((e) => e.trim() !== "")).toBe(true);
});

test("linked-text fixture keeps link text and destination in parsed entries", () => {
  const [v] = parseChangelog(read("./__fixtures__/changelog-linked-text-entry.md"));
  expect(v.entries).toEqual([
    "Read the [provider guide](docs/adding-a-provider.md) before adding a provider.",
    'Secrets live in [Phantom](https://phm.dev "Phantom Secrets"), not in the repo.',
  ]);
  expect(inlineLinks(v.entries.join("\n"))).toEqual([
    { label: "provider guide", destination: "docs/adding-a-provider.md" },
    { label: "Phantom", destination: "https://phm.dev" },
  ]);
});

test("blank and whitespace-only lines never add, drop or reorder entries across versions", () => {
  const md = read("./__fixtures__/changelog-blank-lines-multi-version.md");
  const expected: ChangelogVersion[] = [
    { version: null, date: null, entries: ["Pending A.", "Pending B."] },
    { version: "0.7.0", date: "2026-11-03", entries: ["Fixed one.", "Fixed two.", "Added one."] },
    { version: "0.6.0", date: "2026-10-31", entries: ["Old one.", "Old two."] },
  ];
  expect(parseChangelog(md)).toEqual(expected);
  // Removing every blank line must not change the result.
  const compact = md.split("\n").filter((l) => l.trim() !== "").join("\n");
  expect(parseChangelog(compact)).toEqual(expected);
});

test("site CHANGELOG.md parses the same with all blank lines removed", () => {
  const md = read("../packages/site/src/data/CHANGELOG.md");
  const compact = md.split("\n").filter((l) => l.trim() !== "").join("\n");
  expect(parseChangelog(compact)).toEqual(parseChangelog(md));
});

test("site CHANGELOG.md without final newline parses the final entry completely", () => {
  // Fixture is a copy of packages/site/src/data/CHANGELOG.md with the trailing newline stripped.
  const noNewline = read("./__fixtures__/changelog-no-final-newline-site.md");
  expect(noNewline.endsWith("\n")).toBe(false);

  const parsed = parseChangelog(noNewline);
  const normal = parseChangelog(read("../packages/site/src/data/CHANGELOG.md"));
  // Parsed output must be identical regardless of trailing newline.
  expect(parsed).toEqual(normal);

  // Verify the final entry is present and complete.
  const last = parsed[parsed.length - 1];
  expect(last.version).toBe("0.1.0");
  expect(last.date).toBe("2026-04-19");
  expect(last.entries.at(-1)).toBe(
    "47 tests across 12 files; fetch-mocked provider tests and fake-phantom integration harness.",
  );
});

test("empty input returns no changelog sections from any parser", () => {
  expect(parseChangelog("")).toEqual([]);
  expect(versionSections("")).toEqual([]);
  expect(sectionEntries("")).toEqual([]);
  expect(versionBodies("").size).toBe(0);
  expect(malformedHeadings("")).toEqual([]);
});

test("whitespace-only input returns no changelog sections from any parser", () => {
  for (const ws of [" ", "   \t  ", "\n", "\n\n\n", " \n\t\n  \n", "\r\n \r\n", "  \n"]) {
    expect(parseChangelog(ws)).toEqual([]);
    expect(versionSections(ws)).toEqual([]);
    expect(sectionEntries(ws)).toEqual([]);
    expect(versionBodies(ws).size).toBe(0);
    expect(malformedHeadings(ws)).toEqual([]);
  }
});

test("multiple-section fixture keeps section order and entry membership per version", () => {
  // Sections are deliberately non-alphabetical, and "Fixed"/"Added" repeat across versions.
  const md = read("./__fixtures__/changelog-multi-section.md");
  expect(sectionEntries(md)).toEqual([
    { version: "## Unreleased", section: "Fixed", entries: ["Pending fix."] },
    { version: "## 0.8.0 (2026-11-03)", section: "Removed", entries: ["Removed one."] },
    { version: "## 0.8.0 (2026-11-03)", section: "Added", entries: ["Added one.", "Added two."] },
    { version: "## 0.8.0 (2026-11-03)", section: "Fixed", entries: ["Fixed one."] },
    { version: "## 0.7.0 (2026-11-02)", section: "Fixed", entries: ["Older fix."] },
    { version: "## 0.7.0 (2026-11-02)", section: "Added", entries: ["Older add."] },
  ]);
  // The flat parser sees the same entries, grouped by version in the same order.
  expect(parseChangelog(md)).toEqual([
    { version: null, date: null, entries: ["Pending fix."] },
    { version: "0.8.0", date: "2026-11-03", entries: ["Removed one.", "Added one.", "Added two.", "Fixed one."] },
    { version: "0.7.0", date: "2026-11-02", entries: ["Older fix.", "Older add."] },
  ]);
  expect(malformedHeadings(md)).toEqual([]);
});

test("multi-section fixture parses the same with and without a final newline in every parser", () => {
  const withNewline = read("./__fixtures__/changelog-multi-section.md");
  const without = read("./__fixtures__/changelog-multi-section-no-final-newline.md");
  expect(withNewline.endsWith("\n")).toBe(true);
  expect(without.endsWith("\n")).toBe(false);
  // The pair must be equivalent apart from the trailing newline.
  expect(without).toBe(withNewline.replace(/\n$/, ""));

  expect(parseChangelog(without)).toEqual(parseChangelog(withNewline));
  expect(sectionEntries(without)).toEqual(sectionEntries(withNewline));
  expect(versionSections(without)).toEqual(versionSections(withNewline));
  expect([...versionBodies(without)]).toEqual([...versionBodies(withNewline)]);
  expect(malformedHeadings(without)).toEqual(malformedHeadings(withNewline));
  // The last entry survives without the newline.
  expect(parseChangelog(without).at(-1)?.entries.at(-1)).toBe("Older add.");
});
