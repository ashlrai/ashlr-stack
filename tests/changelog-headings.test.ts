import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { inlineLinks, sectionEntries } from "./changelog-parser-utils";

const DATE = "\\d{4}-\\d{2}-\\d{2}";
/** `## Unreleased`, `## 0.3.0 (DATE)`, `## [0.2.0] — DATE`, `## 0.1.0 — DATE (note)`. */
const VERSION_HEADING = new RegExp(
  `^## (?:Unreleased|(?:\\d+\\.\\d+\\.\\d+|\\[\\d+\\.\\d+\\.\\d+\\]) (?:\\(${DATE}\\)|— ${DATE})(?: \\([^()]+\\))?)$`,
);

/** Returns every level-2 heading that is not well formed (fenced code is ignored). */
export function malformedHeadings(markdown: string): string[] {
  let fenced = false;
  const bad: string[] = [];
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^##(?!#)/.test(line) && !VERSION_HEADING.test(line)) bad.push(line);
  }
  return bad;
}

test("every CHANGELOG.md version heading is well formed", () => {
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  expect(malformedHeadings(changelog)).toEqual([]);
});

test("accepts the heading styles used in the changelog", () => {
  const ok = [
    "## Unreleased",
    "## 0.3.0 (2026-10-31)",
    "## [0.2.0] — 2026-04-23",
    "## 0.1.1 — 2026-04-19",
    "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)",
  ];
  expect(malformedHeadings(ok.join("\n"))).toEqual([]);
});

test("detects malformed version headings in a fixture", () => {
  const fixture = [
    "# Changelog",
    "## Unreleased",
    "## v0.3.0 (2026-10-31)",
    "## 0.3 (2026-10-31)",
    "## 0.2.2 (2026-1-25)",
    "## [0.2.1 — 2026-10-16",
    "## 0.2.0",
    "##0.1.1 (2026-04-19)",
    "## 0.1.0 - 2026-04-19",
    "## 0.0.9 (2026-04-19) trailing",
    "### 0.0.8 sub-heading is ignored",
    "```",
    "## fenced is ignored",
    "```",
    "## 0.0.7 (2026-04-19)",
  ].join("\n");
  expect(malformedHeadings(fixture)).toEqual([
    "## v0.3.0 (2026-10-31)",
    "## 0.3 (2026-10-31)",
    "## 0.2.2 (2026-1-25)",
    "## [0.2.1 — 2026-10-16",
    "## 0.2.0",
    "##0.1.1 (2026-04-19)",
    "## 0.1.0 - 2026-04-19",
    "## 0.0.9 (2026-04-19) trailing",
  ]);
});

test("empty changelog fixture parses with no results from every parser function", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-empty.md", import.meta.url), "utf8");
  expect(fixture).toBe("");
  // malformedHeadings returns no bad headings without throwing.
  expect(() => malformedHeadings(fixture)).not.toThrow();
  expect(malformedHeadings(fixture)).toEqual([]);
  // versionSections returns no versions without throwing.
  expect(() => versionSections(fixture)).not.toThrow();
  expect(versionSections(fixture)).toEqual([]);
  // sectionEntries returns no entries without throwing.
  expect(() => sectionEntries(fixture)).not.toThrow();
  expect(sectionEntries(fixture)).toEqual([]);
  // inlineLinks on empty body returns no links without throwing.
  expect(() => inlineLinks(fixture)).not.toThrow();
  expect(inlineLinks(fixture)).toEqual([]);
});

test("whitespace-only input returns no sections from every parser function without throwing", () => {
  for (const input of [" ", "\n", "\r\n", "   \n\t\n  \r\n\n", "\u00a0\u2003\n"]) {
    expect(() => malformedHeadings(input)).not.toThrow();
    expect(malformedHeadings(input)).toEqual([]);
    expect(() => versionSections(input)).not.toThrow();
    expect(versionSections(input)).toEqual([]);
    expect(() => sectionEntries(input)).not.toThrow();
    expect(sectionEntries(input)).toEqual([]);
    expect(() => inlineLinks(input)).not.toThrow();
    expect(inlineLinks(input)).toEqual([]);
  }
});

test("prose before the first version is not a version and the first version stays intact", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-preamble.md", import.meta.url), "utf8");
  const lines = fixture.split("\n");
  const versions = lines.filter((l) => /^## /.test(l));
  expect(malformedHeadings(fixture)).toEqual([]);
  expect(versions).toEqual(["## 0.2.0 (2026-04-23)", "## 0.1.0 (2026-04-19)"]);
  // The first version section starts at its heading and keeps its own body.
  const first = lines.indexOf(versions[0]);
  const second = lines.indexOf(versions[1]);
  expect(lines.slice(first, second).join("\n")).toContain("- First version entry stays intact.");
  // Nothing before it (the preamble) leaks a version-like heading.
  expect(lines.slice(0, first).filter((l) => /^## /.test(l))).toEqual([]);
});

/** Version sections in source order: heading line → body up to the next `## ` heading. */
function versionSections(markdown: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^##(?!#)/.test(line)) sections.push({ heading: line, body: "" });
    else if (sections.length > 0) sections[sections.length - 1].body += `${line}\n`;
  }
  return sections;
}

test("three-version fixture parses all versions in source order with their own bodies", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-three-versions.md", import.meta.url), "utf8");
  expect(malformedHeadings(fixture)).toEqual([]);
  const sections = versionSections(fixture);
  expect(sections.map((s) => s.heading)).toEqual([
    "## 0.3.0 (2026-05-01)",
    "## [0.2.0] — 2026-04-23",
    "## 0.1.0 (2026-04-19)",
  ]);
  const [third, second, first] = sections.map((s) => s.body);
  expect(third).toContain("- Third version entry.");
  expect(second).toContain("- Second version entry.");
  expect(first).toContain("- First version entry.");
  // Each body holds only its own entry.
  for (const [body, own] of [[third, "Third"], [second, "Second"], [first, "First"]] as const) {
    expect(body.match(/^- .*$/gm)).toEqual([`- ${own} version entry.`]);
  }
});

test("blank lines inside a version body stay in the parsed body", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-blank-lines.md", import.meta.url), "utf8");
  expect(malformedHeadings(fixture)).toEqual([]);
  const [newer, older] = versionSections(fixture);
  expect(newer.heading).toBe("## 0.2.0 (2026-04-23)");
  // Single and repeated blank lines between entries are kept verbatim.
  expect(newer.body).toContain("### Added\n\n\n- First entry.\n\n\n\n- Second entry after three blank lines.\n\n### Fixed\n\n- Fix entry.\n");
  expect(newer.body.split("\n").filter((l) => l === "").length).toBe(10);
  expect(older.body).toBe("\n- Old entry.\n\n");
});

test("blank lines between entries do not add, drop or reorder entries", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-blank-lines.md", import.meta.url), "utf8");
  const expected = [
    { version: "## 0.2.0 (2026-04-23)", section: "Added", entries: ["First entry.", "Second entry after three blank lines."] },
    { version: "## 0.2.0 (2026-04-23)", section: "Fixed", entries: ["Fix entry."] },
  ];
  expect(sectionEntries(fixture)).toEqual(expected);
  // Removing every blank line yields the same entries in the same order.
  expect(sectionEntries(fixture.replace(/\n{2,}/g, "\n"))).toEqual(expected);
  // Adding a blank line after every line changes nothing either.
  expect(sectionEntries(fixture.replace(/\n/g, "\n\n"))).toEqual(expected);
});

test("blank and whitespace-only lines keep entries in their own section and order across versions", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-blank-lines-multi-version.md", import.meta.url), "utf8");
  const expected = [
    { version: "## 0.7.0 (2026-11-03)", section: "Fixed", entries: ["Fixed one.", "Fixed two."] },
    { version: "## 0.7.0 (2026-11-03)", section: "Added", entries: ["Added one."] },
  ];
  // Entries under `### Fixed` must not leak into `### Added` across the blank lines between them.
  expect(sectionEntries(fixture)).toEqual(expected);
  expect(sectionEntries(fixture.split("\n").filter((l) => l.trim() !== "").join("\n"))).toEqual(expected);
  expect(versionSections(fixture).map((s) => s.heading)).toEqual([
    "## Unreleased",
    "## 0.7.0 (2026-11-03)",
    "## 0.6.0 (2026-10-31)",
  ]);
});

test("a Markdown link in a version body keeps its label and destination", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-links.md", import.meta.url), "utf8");
  expect(malformedHeadings(fixture)).toEqual([]);
  const [newer, older] = versionSections(fixture);
  // The link text survives verbatim inside the body, not just the parsed pieces.
  expect(newer.body).toContain("[provider guide](docs/adding-a-provider.md)");
  expect(newer.body).toContain('[Phantom](https://phm.dev "Phantom Secrets")');
  expect(inlineLinks(newer.body)).toEqual([
    { label: "provider guide", destination: "docs/adding-a-provider.md" },
    { label: "Phantom", destination: "https://phm.dev" },
  ]);
  // A link belongs to its own version only.
  expect(inlineLinks(older.body)).toEqual([]);
});

test("a parsed entry keeps its link text and destination", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-links.md", import.meta.url), "utf8");
  const added = sectionEntries(fixture).find((g) => g.section === "Added")!;
  // Entries are kept verbatim, link markup included.
  expect(added.entries).toEqual([
    "See the [provider guide](docs/adding-a-provider.md) for every file a provider touches.",
    'Secrets live in [Phantom](https://phm.dev "Phantom Secrets") and never in the repo.',
  ]);
  // Each entry yields exactly its own link; the optional title is not part of the destination.
  expect(added.entries.map((e) => inlineLinks(e))).toEqual([
    [{ label: "provider guide", destination: "docs/adding-a-provider.md" }],
    [{ label: "Phantom", destination: "https://phm.dev" }],
  ]);
});

test("both paragraphs of a multi-paragraph entry stay attached to the same version", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-multi-paragraph.md", import.meta.url), "utf8");
  expect(malformedHeadings(fixture)).toEqual([]);
  const [newer, older] = versionSections(fixture);
  expect(newer.heading).toBe("## 0.2.0 (2026-04-23)");
  expect(newer.body).toContain(
    "- First paragraph of the entry states the change.\n\n  Second paragraph of the same entry explains why and stays attached to 0.2.0.\n",
  );
  // The blank line between paragraphs does not start a new version.
  expect(older.body).not.toContain("paragraph");
});

test("the site CHANGELOG.md mirror parses with well-formed headings and non-empty versions", () => {
  const site = readFileSync(new URL("../packages/site/src/data/CHANGELOG.md", import.meta.url), "utf8");
  expect(malformedHeadings(site)).toEqual([]);
  for (const s of versionSections(site)) expect(s.body.trim()).not.toBe("");
});

test("repeated section headings keep entries with their own version and section", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-repeated-sections.md", import.meta.url), "utf8");
  expect(malformedHeadings(fixture)).toEqual([]);
  expect(sectionEntries(fixture)).toEqual([
    { version: "## 0.2.0 (2026-04-23)", section: "Added", entries: ["New in 0.2.0 (first Added)."] },
    { version: "## 0.2.0 (2026-04-23)", section: "Fixed", entries: ["Fixed in 0.2.0."] },
    { version: "## 0.2.0 (2026-04-23)", section: "Added", entries: ["New in 0.2.0 (second Added, same version)."] },
    { version: "## 0.1.0 (2026-04-19)", section: "Added", entries: ["New in 0.1.0."] },
    { version: "## 0.1.0 (2026-04-19)", section: "Fixed", entries: ["Fixed in 0.1.0."] },
  ]);
});

test("the site CHANGELOG.md mirror keeps every entry under a version and section", () => {
  const site = readFileSync(new URL("../packages/site/src/data/CHANGELOG.md", import.meta.url), "utf8");
  const sections = sectionEntries(site);
  expect(sections.length).toBeGreaterThan(0);
  for (const s of sections) {
    expect(s.version).not.toBe("");
    expect(s.section.trim()).not.toBe("");
  }
});

test("heading-only fixture returns each version with no fabricated body or entries", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-heading-only.md", import.meta.url), "utf8");
  expect(malformedHeadings(fixture)).toEqual([]);
  const sections = versionSections(fixture);
  expect(sections.map((s) => s.heading)).toEqual(["## 0.2.0 (2026-04-23)", "## 0.1.0 (2026-04-19)"]);
  for (const s of sections) expect(s.body.trim()).toBe("");
  expect(sectionEntries(fixture)).toEqual([]);
  // A version heading as the very last line (no newline, no body) is still returned.
  expect(versionSections("## 0.1.0 (2026-04-19)").map((s) => s.heading)).toEqual(["## 0.1.0 (2026-04-19)"]);
  expect(sectionEntries("## 0.1.0 (2026-04-19)")).toEqual([]);
});


test("Original PR 758: whitespace-only changelog fixture parses with no results from every parser function", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-whitespace-only.md", import.meta.url), "utf8");
  expect(fixture.length).toBeGreaterThan(0);
  expect(fixture.trim()).toBe("");
  for (const text of [fixture, fixture.replace(/\n/g, "\r\n"), " \t\n\n  "]) {
    expect(() => {
      malformedHeadings(text);
      versionSections(text);
      sectionEntries(text);
      inlineLinks(text);
    }).not.toThrow();
    expect(malformedHeadings(text)).toEqual([]);
    expect(versionSections(text)).toEqual([]);
    expect(sectionEntries(text)).toEqual([]);
    expect(inlineLinks(text)).toEqual([]);
  }
});
