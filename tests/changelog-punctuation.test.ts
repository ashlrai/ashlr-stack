import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries, versionSections } from "./changelog-parser-utils";

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
