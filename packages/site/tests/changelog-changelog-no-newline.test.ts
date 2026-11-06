import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";
import { latestReleaseFromChangelog } from "../scripts/gen-site-facts";

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order; `raw` is the body's exact source text. */
function parseVersions(markdown: string): { heading: string; body: Token[]; raw: string }[] {
  const versions: { heading: string; body: Token[]; raw: string }[] = [];
  let current: { heading: string; body: Token[]; raw: string } | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 && VERSION.test(token.text) ? { heading: token.text, body: [], raw: "" } : null;
      if (current) versions.push(current);
    } else if (current) {
      current.body.push(token);
      current.raw += token.raw;
    }
  }
  return versions;
}

/** All list-item texts across every list in a version body. */
function allListItems(body: Token[]): string[] {
  const items: string[] = [];
  for (const t of body) {
    if (t.type === "list") {
      const list = t as { items: { text: string }[] };
      items.push(...list.items.map((i) => i.text));
    }
  }
  return items;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-no-final-newline-site.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

test("fixture really ends without a trailing newline", () => {
  expect(fixture.endsWith("\n")).toBe(false);
  // Final line is the last bullet entry — no newline after the period.
  expect(fixture.endsWith("fake-phantom integration harness.")).toBe(true);
});

test("final version entry is fully parsed when the input ends immediately after its text", () => {
  const versions = parseVersions(fixture);
  const last = versions[versions.length - 1];
  expect(last.heading).toBe("0.1.0 — 2026-04-19 (superseded by 0.1.1)");

  // The final entry must appear among all list items in the version.
  const items = allListItems(last.body);
  expect(items.at(-1)).toBe(
    "47 tests across 12 files; fetch-mocked provider tests and fake-phantom integration harness.",
  );
  // The `raw` body text ends right at the final entry — no truncation.
  expect(last.raw.endsWith("- 47 tests across 12 files; fetch-mocked provider tests and fake-phantom integration harness.")).toBe(true);
});

test("fixture has the same version headings as the published changelog", () => {
  const fixtureVersions = parseVersions(fixture);
  const publishedVersions = parseVersions(published);
  expect(fixtureVersions.map((v) => v.heading)).toEqual(publishedVersions.map((v) => v.heading));
});

test("fixture version bodies match the published changelog with trailing newline stripped", () => {
  const fixtureVersions = parseVersions(fixture);
  const strippedVersions = parseVersions(published.replace(/\n+$/, ""));
  expect(fixtureVersions.map((v) => v.heading)).toEqual(strippedVersions.map((v) => v.heading));
  expect(fixtureVersions.map((v) => v.raw.trimEnd())).toEqual(strippedVersions.map((v) => v.raw.trimEnd()));
});

test("site-facts release lookup still finds the latest release", () => {
  expect(latestReleaseFromChangelog(fixture)).toEqual({ version: "0.3.2", date: "2026-11-04", scope: "source-changelog" });
});
