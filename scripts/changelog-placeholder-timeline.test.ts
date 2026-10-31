import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/changelog-placeholder-timeline.md");
const doc = readFileSync(docPath, "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const siteChangelog = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");

const STOP_HEADING = "## 0.2.1 (2026-10-16)";
const STOP_ENTRY = "**`stack apply` stops attempting to write placeholder secrets.**";

// The text of one `## ` release section, heading included.
function releaseSection(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  expect(start, `missing heading: ${heading}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const end = rest.slice(heading.length).search(/^## /m);
  return end === -1 ? rest : rest.slice(0, heading.length + end);
}

test("site changelog data mirrors the root changelog", () => {
  expect(siteChangelog).toBe(changelog);
});

test("both changelogs record the placeholder-stop entry as 0.2.1's first bug fix", () => {
  for (const text of [changelog, siteChangelog]) {
    const section = releaseSection(text, STOP_HEADING);
    const bugFixes = section.slice(section.indexOf("### Bug fixes") + "### Bug fixes".length);
    expect(bugFixes.trimStart().startsWith(`- ${STOP_ENTRY}`)).toBe(true);
    expect(bugFixes).toContain("TODO_STACK_APPLY");
    expect(bugFixes).toContain("`present` and `missing`");
  }
});

test("doc identifies the 0.2.1 stop entry and links both changelog copies", () => {
  const flat = doc.replace(/\s+/g, " ");
  expect(flat).toContain(STOP_HEADING.slice(3));
  expect(flat).toContain(STOP_ENTRY);
  expect(doc).toContain("](../CHANGELOG.md)");
  expect(doc).toContain("](../packages/site/src/data/CHANGELOG.md)");
});

test("blockquotes in the doc are verbatim changelog text", () => {
  const flatChangelog = changelog.replace(/\s+/g, " ");
  const quotes = doc.match(/(^> .+\n?)+/gm) ?? [];
  expect(quotes.length).toBeGreaterThanOrEqual(1);
  for (const quote of quotes) {
    const text = quote
      .split("\n")
      .map((line) => line.replace(/^> ?/, ""))
      .join(" ")
      .trim();
    expect(flatChangelog, `quote not in changelog: ${text.slice(0, 60)}…`).toContain(text);
  }
});

test("every changelog heading cited in the doc exists in both changelogs", () => {
  const cited = [...doc.matchAll(/`## ([^`]+)`/g)].map((match) => `## ${match[1]}`);
  expect(cited.length).toBeGreaterThanOrEqual(4);
  for (const heading of cited) {
    for (const text of [changelog, siteChangelog]) {
      expect(text, `missing heading in changelog: ${heading}`).toContain(`\n${heading}`);
    }
  }
});

test("every relative link in the doc resolves to a file", () => {
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target === "" || /^[a-z]+:/.test(target)) continue;
    expect(existsSync(resolve(dirname(docPath), target)), `broken link: ${match[1]}`).toBe(true);
  }
});
