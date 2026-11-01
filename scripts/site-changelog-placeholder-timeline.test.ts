import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const doc = readFileSync(join(root, "docs/site-changelog-placeholder-timeline.md"), "utf8");
const changelog = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
const sitePath = "../packages/site/src/data/CHANGELOG.md";

test("timeline links each cited release to an existing site changelog heading", () => {
  const headings = [
    ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "010--2026-04-19-superseded-by-011"],
    ["0.2.1 (2026-10-16)", "021-2026-10-16"],
    ["0.2.2 (2026-10-25)", "022-2026-10-25"],
    ["0.3.0 (2026-10-31)", "030-2026-10-31"],
    ["Unreleased", "unreleased"],
  ];
  for (const [heading, anchor] of headings) {
    expect(changelog).toContain(`\n## ${heading}\n`);
    expect(doc).toContain(`](${sitePath}#${anchor})`);
  }
});

test("timeline identifies the stop entry and its operational qualifications", () => {
  const fix = changelog.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
  const fixes = fix?.split("### Bug fixes\n")[1];
  expect(fixes?.trimStart()).toStartWith("- **`stack apply` stops attempting to write placeholder secrets.**");
  for (const phrase of ["TODO_STACK_APPLY", "`WireResult.envelopes`", "`present` and `missing`"]) {
    expect(fixes).toContain(phrase);
    expect(doc).toContain(phrase);
  }
  for (const phrase of [
    "0.2.1 was tagged but its npm publish failed",
    "unreadable",
    "provider failures do",
    "`--noWire`",
  ]) {
    expect(doc.replace(/\s+/g, " ")).toContain(phrase);
  }
});
