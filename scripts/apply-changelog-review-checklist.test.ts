import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const checklist = read("docs/apply-changelog-review-checklist.md");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const title = "`stack apply` stops attempting to write placeholder secrets.";

test("checklist identifies the corresponding fix in both changelogs", () => {
  expect(checklist).toContain("0.2.1 (2026-10-16) → Bug fixes");
  expect(checklist).toContain(title);
  for (const path of paths) {
    expect(checklist).toContain(`../${path}#021-2026-10-16`);
    const source = read(path);
    const release = source.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
    const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
    const entries = fixes?.split("\n").filter((line) => line.includes(title)) ?? [];
    expect(entries).toHaveLength(1);
    expect(source.split(title)).toHaveLength(2);
  }
});

test("checklist prompts comparison of behavior and later qualifications", () => {
  for (const topic of [
    "compare what each says `stack apply` does",
    "provider setup",
    "readable vault",
    "unreadable",
    "`WireResult.envelopes`",
    "Unreleased → Changed",
    "0.3.0 →",
    "including failures",
    "webhook stubs",
    "`--noWire`",
    "before\n  running site build",
    "diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md",
  ]) expect(checklist).toContain(topic);
});
