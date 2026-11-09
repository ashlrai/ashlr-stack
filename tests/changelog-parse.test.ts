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

test("two entries under one version retain source order", () => {
  const markdown = ["## 1.2.3 (2026-11-09)", "- Zebra change.", "- Alpha change."].join("\n");

  expect(parseChangelog(markdown)).toEqual([
    { version: "1.2.3", date: "2026-11-09", entries: ["Zebra change.", "Alpha change."] },
  ]);
});

test("a version with two entries keeps both texts verbatim and in source order between neighbours", () => {
  const first = "zulu  entry with  double spaces and trailing space. ";
  const second = "Alpha entry: `code`, **bold**, [link](x) & 100%.";
  const md = [
    "## 1.3.0 (2026-11-09)",
    "- Newer neighbour.",
    "## 1.2.0 (2026-11-08)",
    `- ${first}`,
    `- ${second}`,
    "## 1.1.0 (2026-11-07)",
    "- Older neighbour.",
  ].join("\n");
  const expected: ChangelogVersion[] = [
    { version: "1.3.0", date: "2026-11-09", entries: ["Newer neighbour."] },
    { version: "1.2.0", date: "2026-11-08", entries: [first, second] },
    { version: "1.1.0", date: "2026-11-07", entries: ["Older neighbour."] },
  ];

  const parsed = parseChangelog(md);
  expect(parsed).toEqual(expected);
  // Text is neither trimmed nor sorted, and the two entries never merge.
  expect(parsed[1].entries).toHaveLength(2);
  expect(parsed[1].entries[0]).toBe(first);
  expect(parsed[1].entries).not.toEqual([...parsed[1].entries].sort());
  expect(parseChangelog(md.replace(/\n/g, "\r\n"))).toEqual(expected);
});

test("LF and CRLF changelogs produce the same entries without a final newline", () => {
  const lf = [
    "## Unreleased",
    "- Pending change.",
    "```md",
    "- Not an entry.",
    "```",
    "## [1.2.3] (2026-11-09)",
    "- First change.",
    "- Last change.",
  ].join("\n");
  const expected: ChangelogVersion[] = [
    { version: null, date: null, entries: ["Pending change."] },
    { version: "1.2.3", date: "2026-11-09", entries: ["First change.", "Last change."] },
  ];

  expect(parseChangelog(lf)).toEqual(expected);
  expect(parseChangelog(lf.replace(/\n/g, "\r\n"))).toEqual(expected);
});

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
  // Inline-code text in entries is retained by the parser (backticks preserved).
  expect(v030?.entries[0]).toContain("`stack fleet`");
  expect(v030?.entries[1]).toContain("`stack doctor --repos`");
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

test("two-section fixture keeps section names and per-section entries in source order", () => {
  const md = read("./__fixtures__/changelog-two-section-order.md");
  expect(sectionEntries(md)).toEqual([
    { version: "## 0.4.0 (2026-11-03)", section: "Fixed", entries: ["Fixed first.", "Fixed second."] },
    { version: "## 0.4.0 (2026-11-03)", section: "Added", entries: ["Added first.", "Added second."] },
  ]);
  // CRLF endings must not change section or entry order.
  expect(sectionEntries(md.replace(/\n/g, "\r\n"))).toEqual(sectionEntries(md));
});

test("single-section fixture parses the section name and its entries", () => {
  const sections = sectionEntries(read("./__fixtures__/changelog-single-section.md"));
  expect(sections).toEqual([
    {
      version: "## 0.5.0 (2026-11-02)",
      section: "Fixed",
      entries: ["Fixed first entry.", "Fixed second entry.", "Fixed third entry."],
    },
  ]);
  expect(parseChangelog(read("./__fixtures__/changelog-single-section.md"))).toEqual([
    {
      version: "0.5.0",
      date: "2026-11-02",
      entries: ["Fixed first entry.", "Fixed second entry.", "Fixed third entry."],
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
  const entries = parseChangelog(read("./__fixtures__/changelog-inline-code.md"))[0].entries;
  expect(entries).toEqual([
    "Run `stack apply --noWire` to skip wiring; flags like `--json` stay literal.",
    "Code spans keep markup: `a - b`, `[not a link](x)`, and `## not a heading`.",
    "Starts with `--flag` immediately at the beginning.",
    "Ends with `--flag` at the very end.",
    "Multiple spans: `a`, `b`, and `c` in one line.",
  ]);
  // Inline-code delimiters (backticks) are retained in parsed entry text—never stripped.
  for (const entry of entries) expect(entry).toMatch(/`/);
  // Content between delimiters is also preserved (not evaluated as Markdown).
  expect(entries[1]).toContain("a - b");
  expect(entries[1]).toContain("[not a link](x)");
  expect(entries[1]).toContain("## not a heading");
});

test("site CHANGELOG.md retains inline-code text (backticks) in parsed entries", () => {
  const site = parseChangelog(read("../packages/site/src/data/CHANGELOG.md"));
  const v030 = site.find((v) => v.version === "0.3.0");
  expect(v030).toBeDefined();
  // Entries that start with inline code retain their backtick delimiters.
  expect(v030!.entries).toContain(
    "`stack doctor --repos` reports default-branch CI and open PR counts through gh. Only --json may be combined with this mode.",
  );
  expect(v030!.entries).toContain(
    "`stack upgrade --apply` supports npm global upgrades with health checks and rollback; --dry-run remains non-installing. Review installer constraints before use.",
  );
  // Inline code within entries is also preserved.
  expect(v030!.entries.some((e) => e.includes("`stack apply`"))).toBe(true);
  expect(v030!.entries.some((e) => e.includes("`stack fleet`"))).toBe(true);
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

test("site CHANGELOG.md keeps bold lead-ins and the text after them in parsed entries", () => {
  const md = read("../packages/site/src/data/CHANGELOG.md");
  const bulletsWithBold = md.replace(/\r\n/g, "\n").split("\n").filter((l) => /^- \*\*[^*]+\*\*/.test(l));
  expect(bulletsWithBold.length).toBeGreaterThan(0);
  const entries = parseChangelog(md).flatMap((v) => v.entries);
  for (const line of bulletsWithBold) expect(entries).toContain(line.slice(2));
  const entry = entries.find((e) => e.startsWith("**`litellm-gateway` template.**"));
  expect(entry).toContain("** Provider key slots (OpenAI, Anthropic, xAI, DeepSeek)");
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

test("blank lines inside an entry (continuation, nested bullet, fenced block) never create extra entries", () => {
  const md = read("./__fixtures__/changelog-blank-line-continuation.md");
  const expected: ChangelogVersion[] = [
    {
      version: "0.8.0",
      date: "2026-11-03",
      entries: [
        "Entry with a continuation paragraph.",
        "Entry with a fenced block containing blank lines.",
        "Last entry.",
      ],
    },
    { version: "0.7.0", date: "2026-11-02", entries: ["Older entry."] },
  ];
  expect(parseChangelog(md)).toEqual(expected);
  expect(parseChangelog(md.replace(/\n/g, "\r\n"))).toEqual(expected);
  // Doubling every blank line must not change the result either.
  expect(parseChangelog(md.replace(/\n\n/g, "\n\n\n"))).toEqual(expected);
});

test("site CHANGELOG.md parses the same with all blank lines removed", () => {
  const md = read("../packages/site/src/data/CHANGELOG.md");
  const compact = md.split("\n").filter((l) => l.trim() !== "").join("\n");
  expect(parseChangelog(compact)).toEqual(parseChangelog(md));
});

test("site CHANGELOG.md without final newline parses the final entry completely", () => {
  const noNewline = read("../packages/site/src/data/CHANGELOG.md").replace(/\n+$/, "");
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

test("shared parsers keep the last site changelog entry without a final newline", () => {
  const real = read("../packages/site/src/data/CHANGELOG.md");
  const bare = real.replace(/\n+$/, "");
  const lastEntry = "47 tests across 12 files; fetch-mocked provider tests and fake-phantom integration harness.";
  expect(sectionEntries(bare).at(-1)?.entries.at(-1)).toBe(lastEntry);
  expect(versionSections(bare).at(-1)?.body.trimEnd().endsWith(lastEntry)).toBe(true);
  expect([...versionBodies(bare).values()].at(-1)?.trimEnd().endsWith(lastEntry)).toBe(true);
  expect(sectionEntries(bare)).toEqual(sectionEntries(real));
});

test("empty input returns no changelog sections from any parser", () => {
  expect(parseChangelog("")).toEqual([]);
  expect(versionSections("")).toEqual([]);
  expect(sectionEntries("")).toEqual([]);
  expect(versionBodies("").size).toBe(0);
  expect(malformedHeadings("")).toEqual([]);
});

test("empty fixture file returns no changelog sections from any parser without throwing", () => {
  const md = read("./__fixtures__/changelog-empty.md");
  expect(md).toBe("");
  expect(() => {
    parseChangelog(md);
    versionSections(md);
    sectionEntries(md);
    versionBodies(md);
    malformedHeadings(md);
    inlineLinks(md);
  }).not.toThrow();
  expect(parseChangelog(md)).toEqual([]);
  expect(versionSections(md)).toEqual([]);
  expect(sectionEntries(md)).toEqual([]);
  expect(versionBodies(md).size).toBe(0);
  expect(malformedHeadings(md)).toEqual([]);
  expect(inlineLinks(md)).toEqual([]);
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

test("whitespace-only fixture file returns no changelog sections from any parser without throwing", () => {
  const md = read("./__fixtures__/changelog-whitespace-only.md");
  expect(md.length).toBeGreaterThan(0);
  expect(md.trim()).toBe("");
  for (const text of [md, md.replace(/\n/g, "\r\n")]) {
    expect(() => {
      parseChangelog(text);
      versionSections(text);
      sectionEntries(text);
      versionBodies(text);
      malformedHeadings(text);
      inlineLinks(text);
    }).not.toThrow();
    expect(parseChangelog(text)).toEqual([]);
    expect(versionSections(text)).toEqual([]);
    expect(sectionEntries(text)).toEqual([]);
    expect(versionBodies(text).size).toBe(0);
    expect(malformedHeadings(text)).toEqual([]);
    expect(inlineLinks(text)).toEqual([]);
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

test("many-entries fixture keeps every entry in source order, duplicates included", () => {
  expect(parseChangelog(read("./__fixtures__/changelog-many-entries-order.md"))).toEqual([
    { version: null, date: null, entries: ["Zulu pending entry.", "Alpha pending entry.", "Mike pending entry."] },
    {
      version: "0.4.0",
      date: "2026-11-01",
      entries: ["Entry 5.", "Entry 1.", "Entry 4.", "Entry 2.", "Entry 3.", "Entry 1."],
    },
    { version: "0.3.0", date: "2026-10-31", entries: ["Beta.", "Alpha."] },
  ]);
});

test("site CHANGELOG.md entries, concatenated across versions, match its bullet lines in file order", () => {
  const md = read("../packages/site/src/data/CHANGELOG.md");
  const flat = parseChangelog(md).flatMap((v) => v.entries);
  // Independent oracle: top-level bullets after the first version heading, outside code fences.
  const expected: string[] = [];
  let fenced = false;
  let started = false;
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (/^## (Unreleased|\[?\d+\.\d+\.\d+)/.test(line)) started = true;
    else if (started && /^- /.test(line)) expected.push(line.slice(2));
  }
  expect(flat.length).toBeGreaterThan(0);
  expect(flat).toEqual(expected);
});

test("a final newline never changes parsed entries, for the fixture or the site CHANGELOG.md", () => {
  const bare = read("./__fixtures__/changelog-no-final-newline.md");
  expect(bare.endsWith("\n")).toBe(false);
  const site = read("../packages/site/src/data/CHANGELOG.md").replace(/\n+$/, "");
  for (const md of [bare, site]) {
    for (const nl of ["\n", "\r\n", "\n\n"]) {
      const withNl = md + nl;
      expect(parseChangelog(withNl)).toEqual(parseChangelog(md));
      expect(sectionEntries(withNl)).toEqual(sectionEntries(md));
      expect(malformedHeadings(withNl)).toEqual(malformedHeadings(md));
      expect(versionSections(withNl).map((s) => [s.heading, s.body.trimEnd()])).toEqual(
        versionSections(md).map((s) => [s.heading, s.body.trimEnd()]),
      );
      const a = [...versionBodies(withNl)].map(([k, v]) => [k, v.trimEnd()]);
      expect(a).toEqual([...versionBodies(md)].map(([k, v]) => [k, v.trimEnd()]));
    }
  }
  expect(parseChangelog(bare).at(-1)?.entries).toEqual(["First version entry, final line has no newline."]);
});

test("input that ends right after the final entry's text still yields that entry", () => {
  const md = "# Changelog\n\n## Unreleased\n\n- Pending.\n\n## 0.1.0 (2026-01-02)\n\n### Added\n\n- Last entry";
  expect(md.endsWith("\n")).toBe(false);
  expect(parseChangelog(md)).toEqual([
    { version: null, date: null, entries: ["Pending."] },
    { version: "0.1.0", date: "2026-01-02", entries: ["Last entry"] },
  ]);
});

test("root CHANGELOG.md with its trailing newline stripped parses the same, final entry included", () => {
  const full = read("../CHANGELOG.md");
  const bare = full.replace(/\n+$/, "");
  expect(bare.endsWith("\n")).toBe(false);
  const parsed = parseChangelog(bare);
  expect(parsed).toEqual(parseChangelog(full));
  const lastLine = bare.split("\n").filter((l) => l.startsWith("- ")).at(-1) ?? "";
  expect(parsed.at(-1)?.entries.at(-1)).toBe(lastLine.slice(2));
});

test("unicode fixture keeps every parsed entry's characters and code points intact", () => {
  const md = read("./__fixtures__/changelog-unicode.md");
  const entries = {
    pending: "Café ☕ — naïve, “smart quotes”, ‘ticks’",
    cjkEmoji: "日本語のメモ: プロバイダーを追加 🚀 👩‍💻",
    rtl: "مرحبا بالعالم — שלום עולם",
    greek: "Ελληνικά: αβγδ → ✓ done",
    accents: "NFC é (U+00E9) vs NFD é (e + U+0301), Ω ≠ µ",
    cyrillic: "Привет, мир — 你好，世界 🎉",
  };
  expect(parseChangelog(md)).toEqual([
    { version: null, date: null, entries: [entries.pending] },
    { version: "0.3.0", date: "2026-10-31", entries: [entries.cjkEmoji, entries.rtl, entries.greek, entries.accents] },
    { version: "0.2.0", date: "2026-04-23", entries: [entries.cyrillic] },
  ]);
  // CRLF line endings must not disturb non-ASCII text either.
  expect(parseChangelog(md.replace(/\n/g, "\r\n"))).toEqual(parseChangelog(md));
});

test("punctuation fixture keeps every entry's punctuation verbatim", () => {
  expect(parseChangelog(read("./__fixtures__/changelog-parse-punctuation.md"))).toEqual([
    { version: null, date: null, entries: ["Quotes, \"double\" and 'single'; semicolons; and slashes (a/b, c\\d)."] },
    {
      version: "0.3.0",
      date: "2026-10-31",
      entries: [
        "Why did it fail? Now it doesn't! Wait... really? [Yes] {braces} <angles> - dash.",
        "Symbols & more: 50% faster, $5 saved, #1 fix, a+b=c, x*y, ~tilde, @scope/pkg, 100% (done).",
      ],
    },
  ]);
});

test("repeated-entry fixture keeps both identical entries in source order, never merged or deduplicated", () => {
  const md = read("./__fixtures__/changelog-repeated-entry.md");
  const expected: ChangelogVersion[] = [
    { version: null, date: null, entries: ["Same pending entry.", "Same pending entry."] },
    {
      version: "0.9.0",
      date: "2026-11-03",
      entries: ["Repeated fix.", "Unique fix between.", "Repeated fix.", "Repeated fix."],
    },
    { version: "0.8.0", date: "2026-11-02", entries: ["Repeated fix."] },
  ];
  expect(parseChangelog(md)).toEqual(expected);
  expect(parseChangelog(md.replace(/\n/g, "\r\n"))).toEqual(expected);
  // Per-section view: the repeat inside "Fixed" and the one in "Added" stay separate.
  expect(sectionEntries(md).map((s) => [s.section, s.entries])).toEqual([
    ["Fixed", ["Repeated fix.", "Unique fix between.", "Repeated fix."]],
    ["Added", ["Repeated fix."]],
  ]);
});

test("heading-only fixture returns every version with no entries from any parser without throwing", () => {
  const md = read("./__fixtures__/changelog-heading-only.md");
  expect(() => {
    parseChangelog(md);
    versionSections(md);
    sectionEntries(md);
    versionBodies(md);
    malformedHeadings(md);
    inlineLinks(md);
  }).not.toThrow();
  expect(parseChangelog(md)).toEqual([
    { version: "0.2.0", date: "2026-04-23", entries: [] },
    { version: "0.1.0", date: "2026-04-19", entries: [] },
  ]);
  expect(versionSections(md).map((s) => s.heading)).toEqual(["## 0.2.0 (2026-04-23)", "## 0.1.0 (2026-04-19)"]);
  expect(sectionEntries(md)).toEqual([]);
  expect([...versionBodies(md).values()].map((b) => b.trim())).toEqual(["", ""]);
  expect(malformedHeadings(md)).toEqual([]);
  expect(inlineLinks(md)).toEqual([]);
  // A lone heading with no newline and no body is still a version with no entries.
  expect(parseChangelog("## Unreleased")).toEqual([{ version: null, date: null, entries: [] }]);
});

test("blank-line-sections fixture keeps entries on either side of a blank line in their section and order", () => {
  const md = read("./__fixtures__/changelog-blank-line-sections.md");
  const sections = [
    {
      version: "## 0.9.0 (2026-11-03)",
      section: "Fixed",
      entries: ["Fixed before blank.", "Fixed after blank.", "Fixed after whitespace line."],
    },
    { version: "## 0.9.0 (2026-11-03)", section: "Added", entries: ["Added before blank.", "Added after blank."] },
  ];
  expect(sectionEntries(md)).toEqual(sections);
  expect(parseChangelog(md)).toEqual([
    { version: "0.9.0", date: "2026-11-03", entries: sections.flatMap((s) => s.entries) },
  ]);
  // CRLF endings and removing every blank line must not move an entry between sections.
  expect(sectionEntries(md.replace(/\n/g, "\r\n"))).toEqual(sections);
  expect(sectionEntries(md.split("\n").filter((l) => l.trim() !== "").join("\n"))).toEqual(sections);
});

test("numbered-version fixture puts each multi-digit version heading's entry in its own section", () => {
  const md = read("./__fixtures__/changelog-numbered-version.md");
  expect(parseChangelog(md)).toEqual([
    { version: "10.12.134", date: "2026-11-03", entries: ["Entry for the multi-digit version."] },
    { version: "1.10.0", date: "2026-11-02", entries: ["Entry for 1.10.0, not 1.1.0."] },
    { version: "1.1.0", date: "2026-11-01", entries: ["Entry for 1.1.0."] },
  ]);
  expect(sectionEntries(md)).toEqual([
    { version: "## 10.12.134 (2026-11-03)", section: "Added", entries: ["Entry for the multi-digit version."] },
    { version: "## 1.10.0 (2026-11-02)", section: "Fixed", entries: ["Entry for 1.10.0, not 1.1.0."] },
    { version: "## 1.1.0 (2026-11-01)", section: "Changed", entries: ["Entry for 1.1.0."] },
  ]);
  expect([...versionBodies(md).keys()]).toEqual([
    "## 10.12.134 (2026-11-03)",
    "## 1.10.0 (2026-11-02)",
    "## 1.1.0 (2026-11-01)",
  ]);
  expect(malformedHeadings(md)).toEqual([]);
});

test("CRLF fixture and both real CHANGELOG.md files parse like their LF equivalents", () => {
  const sources = [
    read("./__fixtures__/changelog-crlf.md"),
    read("../CHANGELOG.md"),
    read("../packages/site/src/data/CHANGELOG.md"),
  ];
  for (const source of sources) {
    const lf = source.replace(/\r\n/g, "\n");
    const crlf = lf.replace(/\n/g, "\r\n");
    const parsed = parseChangelog(crlf);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed).toEqual(parseChangelog(lf));
    expect(parsed.flatMap((v) => v.entries).some((e) => e.includes("\r"))).toBe(false);
    expect(sectionEntries(crlf)).toEqual(sectionEntries(lf));
    expect(versionSections(crlf).some((s) => s.body.includes("\r") || s.heading.includes("\r"))).toBe(false);
    expect(versionSections(crlf)).toEqual(versionSections(lf));
    expect([...versionBodies(crlf)]).toEqual([...versionBodies(lf)]);
    expect(malformedHeadings(crlf)).toEqual(malformedHeadings(lf));
  }
  expect(parseChangelog(sources[0])).toEqual([
    { version: "0.2.0", date: "2026-05-01", entries: ["Second version entry."] },
    { version: "0.1.0", date: "2026-04-19", entries: ["First version entry."] },
  ]);
});
test("root CHANGELOG.md retains inline-code text in parsed entries", () => {
  const root = parseChangelog(read("../CHANGELOG.md"));
  const v030 = root.find((v) => v.version === "0.3.0");
  expect(v030).not.toBeUndefined();
  // Inline-code entries retain backtick markup in parsed text.
  expect(v030?.entries[0]).toContain("`stack fleet`");
  expect(v030?.entries[1]).toContain("`stack doctor --repos`");
  expect(v030?.entries[3]).toContain("`stack upgrade --apply`");
  // All entries that contain backticks retain matching pairs.
  for (const entry of v030?.entries ?? []) {
    if (entry.includes("`")) {
      const count = (entry.match(/`/g) ?? []).length;
      expect(count % 2).toBe(0);
    }
  }
});

test("multi-entry section fixture from CHANGELOG.md keeps entries in source order", () => {
  const fixture = read("./__fixtures__/changelog-source-multi-entry-section.md");
  const [unreleased] = parseChangelog(fixture);
  expect(unreleased.entries).toHaveLength(3);
  expect(unreleased.entries.map((e) => /\(#(\d+)\)\.$/.exec(e)?.[1])).toEqual(["360", "354", "363"]);
  expect(unreleased.entries[0]).toStartWith("Fleet JSONL reads");
  expect(unreleased.entries[1]).toStartWith("The release workflow renders");
  expect(unreleased.entries[2]).toStartWith("The MCP Registry workflow");
  expect(sectionEntries(fixture)).toEqual([
    { version: "## Unreleased", section: "Fixed", entries: unreleased.entries },
  ]);
});

test("multi-entry fixture entries are still the Unreleased Fixed entries of CHANGELOG.md", () => {
  const fixture = parseChangelog(read("./__fixtures__/changelog-source-multi-entry-section.md"))[0].entries;
  const source = sectionEntries(read("../CHANGELOG.md")).find(
    (g) => g.version === "## Unreleased" && g.section === "Fixed",
  );
  expect(fixture).toEqual(source?.entries);
});

test("site two-entry fixture returns two consecutive entries in source order", () => {
  const fixture = read("./__fixtures__/changelog-site-two-entry-order.md");
  const [unreleased] = parseChangelog(fixture);
  expect(unreleased.entries).toHaveLength(2);
  expect(unreleased.entries[0]).toStartWith("Fleet JSONL reads");
  expect(unreleased.entries[1]).toStartWith("The release workflow renders");
  expect(sectionEntries(fixture)).toEqual([
    { version: "## Unreleased", section: "Fixed", entries: unreleased.entries },
  ]);
});

test("site two-entry fixture is the first two consecutive Unreleased Fixed entries of the site CHANGELOG.md", () => {
  const fixture = parseChangelog(read("./__fixtures__/changelog-site-two-entry-order.md"))[0].entries;
  const source = sectionEntries(read("../packages/site/src/data/CHANGELOG.md")).find(
    (g) => g.version === "## Unreleased" && g.section === "Fixed",
  );
  expect(fixture).toEqual(source?.entries.slice(0, 2));
});

test("multi-version fixture keeps each entry under its own version heading", () => {
  const fixture = read("./__fixtures__/changelog-source-multi-version.md");
  expect(parseChangelog(fixture).map((v) => [v.version, v.entries.length])).toEqual([
    [null, 1],
    ["0.3.0", 2],
  ]);
  const groups = sectionEntries(fixture);
  expect(groups.map((g) => [g.version, g.section])).toEqual([
    ["## Unreleased", "Changed"],
    ["## 0.3.0 (2026-10-31)", "Added"],
  ]);
  // Neither version's entries leak into the other.
  expect(groups[0].entries.some((e) => groups[1].entries.includes(e))).toBe(false);
});

test("multi-version fixture entries are verbatim from the matching version and section of CHANGELOG.md", () => {
  const source = sectionEntries(read("../CHANGELOG.md"));
  const find = (version: string, section: string) =>
    source.find((g) => g.version === version && g.section === section)?.entries ?? [];
  const [changed, added] = sectionEntries(read("./__fixtures__/changelog-source-multi-version.md"));
  expect(changed.entries).toEqual(find("## Unreleased", "Changed").slice(0, 1));
  expect(added.entries).toEqual(find("## 0.3.0 (2026-10-31)", "Added").slice(0, 2));
  expect(added.entries[0]).toStartWith("Fleet diagnostics");
});

test("colon-and-comma fixture retains both punctuation marks in the parsed entry text", () => {
  const [v] = parseChangelog(read("./__fixtures__/changelog-colon-comma.md"));
  expect(v.entries).toEqual(["Fixed timeout handling: connections close cleanly, retries resume, and logs stay readable."]);
  expect(v.entries[0]).toContain(": ");
  expect(v.entries[0]).toContain(", ");
});

test("site CHANGELOG.md entry with a colon and commas keeps them in the parsed text", () => {
  const unreleased = parseChangelog(read("../packages/site/src/data/CHANGELOG.md")).find((v) => v.version === null);
  const entry = unreleased?.entries.find((e) => e.startsWith("Fleet JSONL reads"));
  expect(entry).toContain("while reading: a non-tail read grows one buffer up to the cap, probes");
});

test("real CHANGELOG.md code-span fixture keeps each span and its contents in parsed entries", () => {
  const fixture = read("./__fixtures__/changelog-real-code-span.md");
  const lines = new Set(read("../CHANGELOG.md").split("\n"));
  const [unreleased] = parseChangelog(fixture);
  expect(unreleased.entries).toHaveLength(2);
  // The fixture is verbatim CHANGELOG.md content, not a hand-written approximation.
  for (const entry of unreleased.entries) expect(lines.has(`- ${entry}`)).toBe(true);

  const spans = (e: string) => [...e.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  // Spans holding `$`, `*` and `_` stay literal: no expansion, no emphasis stripping.
  expect(spans(unreleased.entries[0])).toEqual(["$VERSION$", "$SHA_*$", "sed", "$"]);
  expect(unreleased.entries[0]).toContain("(`$VERSION$` and the per-platform `$SHA_*$` values)");
  // A span with a path and dot survives next to parentheses and a trailing `(#363)`.
  expect(spans(unreleased.entries[1])).toEqual(["scripts/mcp-registry-gate.mjs"]);
  expect(unreleased.entries[1]).toContain("(`scripts/mcp-registry-gate.mjs`)");
  // The section parser agrees with parseChangelog on the same text.
  expect(sectionEntries(fixture)[0].entries).toEqual(unreleased.entries);
});


test("Original PR 688: blank-lines-between-entries fixture returns both entries in order without blank entries", () => {
  expect(parseChangelog(read("./__fixtures__/changelog-blank-lines.md"))).toEqual([
    {
      version: "0.2.0",
      date: "2026-04-23",
      entries: ["First entry.", "Second entry after three blank lines.", "Fix entry."],
    },
    { version: "0.1.0", date: "2026-04-19", entries: ["Old entry."] },
  ]);
});


test("Original PR 703: whitespace-only input returns no changelog sections from any parser", () => {
  for (const blank of [" ", "   \n", "\n\n\n", "\t\n \t\n", "\r\n\r\n", "  \n"]) {
    expect(parseChangelog(blank)).toEqual([]);
    expect(versionSections(blank)).toEqual([]);
    expect(sectionEntries(blank)).toEqual([]);
    expect(versionBodies(blank).size).toBe(0);
    expect(malformedHeadings(blank)).toEqual([]);
  }
});


test("Original PR 725: punctuation fixture keeps commas, colons, parentheses, and semicolons in parsed entry text", () => {
  expect(parseChangelog(read("./__fixtures__/changelog-punctuation.md"))).toEqual([
    {
      version: "0.3.0",
      date: "2026-10-31",
      entries: [
        "Added retry logic, with exponential backoff, for unreliable endpoints (see #123).",
        "New provider for Cloudflare Workers: supports binding, streaming, and observability.",
        "Fixed timeout handling: connections now close cleanly (fixes #456, closes #457).",
        "Punctuation in entries: commas, colons (:) and parentheses () are all preserved.",
      ],
    },
    {
      version: "0.2.0",
      date: "2026-04-23",
      entries: [
        "Updated configuration format (breaking: migrate your config file).",
        "Renamed the `stack apply` flag: use `--apply` instead of `--run` (deprecated).",
      ],
    },
    {
      version: "0.1.0",
      date: "2026-04-19",
      entries: ["Initial release: core parsing, version detection, and changelog mirroring."],
    },
  ]);
  // Spot-check individual punctuation characters survived the parse.
  const all = parseChangelog(read("./__fixtures__/changelog-punctuation.md")).flatMap((v) => v.entries);
  expect(all.some((e) => e.includes(", "))).toBe(true);
  expect(all.some((e) => e.includes(": "))).toBe(true);
  expect(all.some((e) => e.includes("("))).toBe(true);
  expect(all.some((e) => e.includes("#123)"))).toBe(true);
});
