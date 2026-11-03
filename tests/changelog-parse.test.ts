import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inlineLinks } from "./changelog-parser-utils";

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
