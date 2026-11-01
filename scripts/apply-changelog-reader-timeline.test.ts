import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const doc = readFileSync(join(root, "docs/apply-changelog-reader-timeline.md"), "utf8");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const entries = [
  ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "010--2026-04-19-superseded-by-011", "calls failed; the 0.2.1 fix above removed the attempts"],
  ["0.2.1 (2026-10-16)", "021-2026-10-16", "every call failed and the printed `envelopes` count was always 0"],
  ["0.2.2 (2026-10-25)", "022-2026-10-25", "its npm publish failed"],
  ["0.3.0 (2026-10-31)", "030-2026-10-31", "unreadable vaults are reported as skipped, not missing"],
  ["Unreleased", "unreleased", "including providers that failed"],
];

test("timeline links each recorded heading in both changelogs in chronological order", () => {
  let previous = -1;
  for (const [heading, fragment, evidence] of entries) {
    const row = doc.split("\n").find((line) => line.startsWith(`| \`${heading}\``));
    expect(row, heading).toBeDefined();
    const position = doc.indexOf(row ?? "");
    expect(position).toBeGreaterThan(previous);
    previous = position;
    for (const source of sources) {
      expect(row).toContain(`](../${source}#${fragment})`);
      const changelog = readFileSync(join(root, source), "utf8");
      const section = changelog.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
      expect(section, `${source}: ${heading}`).toBeDefined();
      expect(section).toContain(evidence);
    }
  }
});

test("timeline preserves distinctions needed to interpret apply results", () => {
  for (const phrase of [
    "annotated with later knowledge",
    "every attempt failed",
    "its npm publish failed",
    "unreadable vault yields skipped providers",
    "including failed providers",
    "Missing names alone do not fail apply; provider failures do",
    "`--noWire` skips both checks and stubs",
    "`phantom add <NAME>` in a trusted terminal",
  ]) {
    expect(doc).toContain(phrase);
  }
});
