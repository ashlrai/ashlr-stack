import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

type Release = { version: string; sections: { name: string; entries: string[] }[] };

/** Released versions in source order, each with its `###` sections and their list entries. */
function parseReleases(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: Release["sections"][number] | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      release = token.depth === 2 && VERSION.test(token.text) ? { version: token.text, sections: [] } : null;
      section = null;
      if (release) releases.push(release);
    } else if (token.type === "heading" && token.depth === 3 && release) {
      section = { name: token.text, entries: [] };
      release.sections.push(section);
    } else if (token.type === "list" && release) {
      // Entries listed straight under the version heading belong to an unnamed section.
      if (!section) release.sections.push((section = { name: "", entries: [] }));
      section.entries.push(...(token as Tokens.List).items.map((item) => item.text));
    }
  }
  return releases;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-multi-version-entries.md"), "utf8");

test("each version keeps its own sections and entries, in source order", () => {
  expect(parseReleases(fixture)).toEqual([
    {
      version: "0.3.0 (2026-05-01)",
      sections: [
        { name: "Added", entries: ["Alpha entry in 0.3.0.", "Beta entry in 0.3.0."] },
        { name: "Fixed", entries: ["Gamma fix in 0.3.0."] },
      ],
    },
    { version: "[0.2.0] — 2026-04-23", sections: [{ name: "Added", entries: ["Only entry in 0.2.0."] }] },
    {
      version: "0.1.0 (2026-04-19)",
      sections: [
        { name: "Added", entries: ["First entry in 0.1.0.", "Second entry in 0.1.0."] },
        { name: "Documentation", entries: ["Docs entry in 0.1.0."] },
      ],
    },
  ]);
});

test("Unreleased and non-version sections contribute no release or entries", () => {
  const all = JSON.stringify(parseReleases(fixture));
  expect(all).not.toContain("Unreleased change");
  expect(all).not.toContain("Not a version");
});

test("the published site changelog parses into ordered releases that each have entries", () => {
  const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const releases = parseReleases(published);
  expect(releases.length).toBeGreaterThanOrEqual(3);
  expect(new Set(releases.map((r) => r.version)).size).toBe(releases.length);
  for (const r of releases) expect(r.sections.some((s) => s.entries.length > 0)).toBe(true);
});
