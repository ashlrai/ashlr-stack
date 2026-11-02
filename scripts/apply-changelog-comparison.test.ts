import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const comparison = readFileSync(join(root, "docs/apply-changelog-comparison.md"), "utf8");
const sources = paths.map((path) => readFileSync(join(root, path), "utf8"));

// Identify each entry by its release, subsection and opening text. Include the
// indented examples and sub-bullets so wording changes there are also detected.
const entries = [
  ["## Unreleased", "### Changed", "- `stack apply` does not create placeholder secrets."],
  ["## 0.3.0 (2026-10-31)", "### Changed and fixed", "- Apply wiring checks existing secret names"],
  ["## 0.3.0 (2026-10-31)", "### Changed", "- After at least one provider succeeds, `stack apply`"],
  ["## 0.2.2 (2026-10-25)", "### Agent-facing output", "- **The last lines of a failing command"],
  ["## 0.2.2 (2026-10-25)", "### Bug fixes", "- **`stack apply` with a missing recipe"],
  ["## 0.2.2 (2026-10-25)", "### Bug fixes", "- **`stack apply` and `stack init --template`"],
  ["## 0.2.1 (2026-10-16)", "### Bug fixes", "- **`stack apply` stops attempting"],
  ["## 0.2.1 (2026-10-16)", "### Hero \"Generate a stack\" demo (from earlier tonight)", "- Clickable in-hero animation"],
  ["## 0.1.0 — 2026-04-19 (superseded by 0.1.1)", "### AI recommendation layer — `stack recommend` + `stack apply`", "- **`stack recommend [query]`**"],
  ["## 0.1.0 — 2026-04-19 (superseded by 0.1.1)", "### AI recommendation layer — `stack recommend` + `stack apply`", "- **`stack apply [recipe-id]`**"],
  ["## 0.1.0 — 2026-04-19 (superseded by 0.1.1)", "### AI recommendation layer — `stack recommend` + `stack apply`", "- **MCP surface**"],
] as const;

function entry(source: string, release: string, section: string, opening: string): string {
  const releaseBody = source.split(`${release}\n`)[1]?.split("\n## ")[0];
  const sectionBody = releaseBody?.split(`${section}\n`)[1]?.split("\n### ")[0];
  const matches = sectionBody?.split(/\n(?=- )/).filter((part) => part.startsWith(opening)) ?? [];
  expect(matches, `${release} / ${section} / ${opening}`).toHaveLength(1);
  return matches[0].trimEnd();
}

test("the documented apply entries match in both checked-in changelogs", () => {
  for (const [release, section, opening] of entries) {
    expect(entry(sources[0], release, section, opening)).toBe(entry(sources[1], release, section, opening));
  }
  expect(sources[0]).toBe(sources[1]);
  expect(comparison).toContain("**no wording differences**");
  for (const path of paths) expect(comparison).toContain(`](../${path})`);
  for (const location of ["Unreleased → Changed", "0.3.0 → Changed and fixed", "0.3.0 → Changed", "0.2.2 → Agent-facing output", "0.2.2 → Bug fixes", "0.2.1 → Bug fixes", "0.2.1 → Hero", "0.1.0 → AI recommendation layer"]) {
    expect(comparison).toContain(location);
  }
  expect(comparison).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
});

test("the entry comparison catches wording changes in examples as well as bullets", () => {
  const changed = sources[1].replace("secrets in vault 0 · missing 1 · webhooks 0", "secrets in vault 0 · missing 2 · webhooks 0");
  const [release, section, opening] = entries[2];
  expect(entry(changed, release, section, opening)).not.toBe(entry(sources[0], release, section, opening));
});
