import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/** Entries per version and `### ` section, in source order. */
function sectionEntries(markdown: string): { version: string; section: string; entries: string[] }[] {
  const out: { version: string; section: string; entries: string[] }[] = [];
  let version = "";
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (/^##(?!#)/.test(line)) version = line;
    else if (/^### /.test(line)) out.push({ version, section: line.slice(4), entries: [] });
    else if (/^- /.test(line) && out.length > 0) out[out.length - 1].entries.push(line.slice(2));
  }
  return out;
}

/** Version sections in source order. */
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

test("punctuation fixture parses version headings correctly", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-punctuation.md", import.meta.url), "utf8");
  const sections = versionSections(fixture);
  expect(sections.map((s) => s.heading)).toEqual([
    "## 0.3.0 (2026-10-31)",
    "## 0.2.0 (2026-04-23)",
    "## 0.1.0 (2026-04-19)",
  ]);
});

test("parsed entries preserve commas, colons, and parentheses", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-punctuation.md", import.meta.url), "utf8");
  const groups = sectionEntries(fixture);

  // 0.3.0 Added: commas and parentheses
  const added = groups.find((g) => g.version.includes("0.3.0") && g.section === "Added")!;
  expect(added.entries).toEqual([
    "Added retry logic, with exponential backoff, for unreliable endpoints (see #123).",
    "New provider for Cloudflare Workers: supports binding, streaming, and observability.",
  ]);
  // Commas preserved
  expect(added.entries[0]).toContain(",");
  // Parentheses preserved
  expect(added.entries[0]).toContain("(see #123)");
  // Colons preserved
  expect(added.entries[1]).toContain(":");

  // 0.3.0 Fixed: colons, parentheses, and commas together
  const fixed = groups.find((g) => g.version.includes("0.3.0") && g.section === "Fixed")!;
  expect(fixed.entries).toEqual([
    "Fixed timeout handling: connections now close cleanly (fixes #456, closes #457).",
    "Punctuation in entries: commas, colons (:) and parentheses () are all preserved.",
  ]);
  expect(fixed.entries[0]).toContain(":");
  expect(fixed.entries[0]).toContain("(");
  expect(fixed.entries[0]).toContain(",");

  // 0.2.0 Changed: parenthetical notes after colons
  const changed = groups.find((g) => g.version.includes("0.2.0") && g.section === "Changed")!;
  expect(changed.entries[0]).toContain("(breaking:");
  expect(changed.entries[1]).toContain(":");

  // 0.1.0: entry with colon outside a section heading
  expect(groups.filter((g) => g.version.includes("0.1.0") && g.section === "" /* top-level entries */)).toHaveLength(0);
});

test("parsed entry bodies retain raw punctuation text verbatim", () => {
  const fixture = readFileSync(new URL("./__fixtures__/changelog-punctuation.md", import.meta.url), "utf8");
  const sections = versionSections(fixture);
  const v030 = sections.find((s) => s.heading.includes("0.3.0"))!;
  // The raw body contains all punctuation exactly as written in the fixture.
  expect(v030.body).toContain(", with exponential backoff,");
  expect(v030.body).toContain("(see #123)");
  expect(v030.body).toContain(": supports binding, streaming,");
  expect(v030.body).toContain("(fixes #456, closes #457)");
  expect(v030.body).toContain("colons (:) and parentheses ()");
});
