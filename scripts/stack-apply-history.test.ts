import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/stack-apply-history.md");
const doc = readFileSync(docPath, "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

const releases = [
  ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "010--2026-04-19-superseded-by-011", "those calls failed"],
  ["0.2.1 (2026-10-16)", "021-2026-10-16", "every call failed"],
  ["0.2.2 (2026-10-25)", "022-2026-10-25", "its npm publish failed"],
  ["0.3.0 (2026-10-31)", "030-2026-10-31", "unreadable vaults are reported as skipped"],
  ["Unreleased", "unreleased", "including providers that failed"],
];

test("history cites real changelog sections in chronological order", () => {
  let previous = -1;
  for (const [heading, anchor, evidence] of releases) {
    const start = changelog.indexOf(`\n## ${heading}\n`);
    expect(start, `missing changelog section: ${heading}`).toBeGreaterThanOrEqual(0);
    const section = changelog.slice(start + 1).split("\n## ")[0];
    expect(section, `${heading}: missing recorded evidence`).toContain(evidence);
    const position = doc.indexOf(`](../CHANGELOG.md#${anchor})`);
    expect(position, `missing or out-of-order citation: ${heading}`).toBeGreaterThan(previous);
    previous = position;
  }
});

test("doc names the former placeholder behavior and the recorded change", () => {
  const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split("\n## ")[0];
  expect(fix).toBeDefined();
  // Recorded facts the doc must match.
  for (const detail of [
    "`phantom add <KEY> TODO_STACK_APPLY --rotate`",
    "the printed `envelopes` count was always 0",
    "`WireResult.envelopes` is replaced by `present` and `missing`",
    "(Successor to #33.)",
  ]) {
    expect(fix, `changelog no longer records: ${detail}`).toContain(detail);
  }
  const text = doc.replace(/\s+/g, " ");
  for (const detail of [
    "`phantom add <KEY> TODO_STACK_APPLY --rotate`",
    "retried without `--rotate`",
    "Every attempt failed",
    "the reported `envelopes` count was always zero",
    "`WireResult.envelopes` was replaced by `present` and `missing`",
    "0.2.2 shipped the fix",
    "wiring checks every provider in the recipe, including providers that failed",
    "`--noWire` skips both the name checks and the stubs",
  ]) {
    expect(text, `doc missing: ${detail}`).toContain(detail);
  }
});

test("placeholders are never presented as credentials", () => {
  const text = doc.replace(/\s+/g, " ");
  expect(text).toContain("not a credential");
  expect(text).toContain("no placeholder was ever stored");
  expect(text).toContain("do not run them");
  expect(text).toContain("`phantom add <NAME>` in a trusted terminal");
  expect(text).toContain("do not pass values in command arguments");
  for (const block of doc.matchAll(/```[\s\S]*?```/g)) {
    expect(block[0]).not.toContain("TODO_STACK_APPLY");
    expect(block[0]).not.toContain("phantom add");
  }
});

test("relative links and changelog anchors resolve", () => {
  const headings = [...changelog.matchAll(/^#+ (.+)$/gm)].map((match) =>
    match[1].toLowerCase().replace(/[^\w\s-]/g, "").replace(/ /g, "-"),
  );
  const links = [...doc.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const [target, fragment] = link.split("#");
    const path = resolve(dirname(docPath), target);
    expect(existsSync(path), `broken link: ${link}`).toBe(true);
    if (fragment && path === join(root, "CHANGELOG.md")) {
      expect(headings, `missing anchor: ${fragment}`).toContain(fragment);
    }
  }
});
