import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const guide = readFileSync(join(root, "docs/apply-history-reader-guide.md"), "utf8");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const entries = [
  ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "010--2026-04-19-superseded-by-011", "those calls failed; the 0.2.1 fix above removed the attempts"],
  ["0.2.1 (2026-10-16)", "021-2026-10-16", "every call failed and the printed `envelopes` count was always 0"],
];

test("guide points to both historical entries in each changelog", () => {
  for (const source of sources) {
    const changelog = readFileSync(join(root, source), "utf8");
    let previous = -1;
    for (const [heading, anchor, evidence] of entries) {
      const section = changelog.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
      expect(section, `${source}: ${heading}`).toContain(evidence);
      const position = guide.indexOf(`](../${source}#${anchor})`);
      expect(position, `${source}: ${heading}`).toBeGreaterThan(previous);
      previous = position;
    }
  }
});

test("guide separates attempted history from the fix and later behavior", () => {
  const text = guide.replace(/\s+/g, " ");
  for (const detail of [
    "later annotations",
    "every attempt failed",
    "not instructions to run or evidence that placeholders were stored",
    "0.2.1 change removed the attempts",
    "provider setup is separate and may store real credentials",
    "its npm publish failed",
    "unreadable vault yields skipped providers",
    "Missing names alone do not fail apply; provider failures do",
    "`--noWire` skips the checks and stubs",
  ]) {
    expect(text).toContain(detail);
  }
});
