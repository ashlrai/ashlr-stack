import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const note = readFileSync(join(root, "docs/changelog-reader-note.md"), "utf8");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

test("reader note links both sources and explains the time and version context", () => {
  for (const source of sources) {
    expect(note).toContain(`](../${source})`);
    expect(note).toContain(`](../${source}#010--2026-04-19-superseded-by-011)`);
    expect(note).toContain(`](../${source}#021-2026-10-16)`);
  }
  expect(note).toContain("Entries describe behavior at their recorded point in time.");
  expect(note).toContain("`Unreleased` describes work recorded for a future");
  expect(note).toContain("which version is installed or deployed");
});

test("the historical example and later fix are present in each linked release", () => {
  for (const source of sources) {
    const changelog = readFileSync(join(root, source), "utf8");
    const original = changelog.split("## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n")[1]?.split("\n## ")[0];
    const fix = changelog.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
    expect(original, source).toContain("Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder");
    expect(original, source).toContain("those calls failed; the 0.2.1 fix above removed the attempts");
    expect(fix, source).toContain("`stack apply` stops attempting to write placeholder secrets.");
    expect(fix, source).toContain("so every call failed");
  }
});
