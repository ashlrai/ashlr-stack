import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-placeholder-terminology.md");
const doc = readFileSync(docPath, "utf8");
const changelogs = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"].map((path) =>
  readFileSync(join(root, path), "utf8"),
);

test("both changelogs record the history and removal described by the glossary", () => {
  for (const changelog of changelogs) {
    const initial = changelog.split("## 0.1.0 — 2026-04-19")[1];
    const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split("\n## ")[0];
    expect(initial).toContain("wiring attempted to write a `TODO_STACK_APPLY` placeholder");
    expect(initial).toContain("those calls failed; the 0.2.1 fix above removed the attempts");
    expect(fix).toContain("phantom add <KEY> TODO_STACK_APPLY --rotate");
    expect(fix).toContain("every call failed");
    expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");
  }
});

test("the glossary defines the historical value and current inventory terms", () => {
  expect(doc).toContain("A literal dummy value");
  expect(doc).toContain("not a credential or a secret name");
  expect(doc).toContain("not successfully stored by those attempts");
  expect(doc).toContain("wiring no longer writes to the vault or fills missing");
  expect(doc).toContain("Skipped does not mean missing or present");
  expect(doc).toContain("`phantom add <NAME>` in a trusted terminal");
  expect(doc).toContain("`--noWire` skips both the inventory");
});

test("the glossary links both changelogs and all relative links resolve", () => {
  expect(doc).toContain("](../CHANGELOG.md)");
  expect(doc).toContain("](../packages/site/src/data/CHANGELOG.md)");
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target === "" || /^[a-z]+:/.test(target)) continue;
    expect(existsSync(resolve(dirname(docPath), target)), `broken link: ${match[1]}`).toBe(true);
  }
});
