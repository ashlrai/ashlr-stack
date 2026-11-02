import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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

test("empty changelog fixture has no malformed headings", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-empty.md", import.meta.url), "utf8");
  expect(() => malformedHeadings(fixture)).not.toThrow();
  expect(malformedHeadings(fixture)).toEqual([]);
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

/** Inline Markdown links `[label](destination "optional title")` in a body, in source order. */
function inlineLinks(body: string): { label: string; destination: string }[] {
  return [...body.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => ({
    label: m[1],
    destination: m[2],
  }));
}

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

test("Unicode characters in a version body survive parsing byte for byte", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-unicode.md", import.meta.url), "utf8");
  expect(malformedHeadings(fixture)).toEqual([]);
  const [newer, older] = versionSections(fixture);
  expect(newer.heading).toBe("## 0.2.0 (2026-04-23)");
  expect(newer.body).toContain("- Café-style naïve “smart quotes” and an em dash — kept intact.");
  expect(newer.body).toContain("- CJK 日本語のテキスト and Cyrillic Привет, мир.");
  // Astral emoji, a ZWJ sequence and a decomposed accent are not split or normalised.
  expect(newer.body).toContain("🚀");
  expect(newer.body).toContain("👩‍💻");
  expect(newer.body).toContain("é");
  expect(newer.body).not.toContain("�");
  // The em dash in a bracketed heading is accepted, and the next body stays ASCII.
  expect(older.heading).toBe("## [0.1.0] — 2026-04-19");
  expect(older.body).toBe("\n- Plain ASCII entry.\n\n");
});

test("the site changelog parses with its non-ASCII characters intact", () => {
  const site = readFileSync(new URL("../packages/site/src/data/CHANGELOG.md", import.meta.url), "utf8");
  expect(malformedHeadings(site)).toEqual([]);
  const sections = versionSections(site);
  expect(sections.length).toBeGreaterThan(0);
  // Re-joining the parsed sections loses no character, so Unicode in any body is preserved.
  const rejoined = sections.map((s) => `${s.heading}\n${s.body}`).join("");
  for (const ch of new Set(site.match(/[^\x00-\x7F]/gu) ?? [])) expect(rejoined).toContain(ch);
  expect(site).not.toContain("�");
});
