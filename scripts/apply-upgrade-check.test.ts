import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const docPath = resolve(import.meta.dir, "../docs/apply-upgrade-check.md");
const doc = readFileSync(docPath, "utf8");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");

test("upgrade checklist tracks the changelog's historical and current behavior", () => {
  const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split("\n## ")[0] ?? "";
  const current = changelog.split("## Unreleased")[1]?.split("\n## ")[0] ?? "";
  expect(fix).toContain("every call failed");
  expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");
  expect(current).toContain("including providers that failed");
  expect(current).toContain("a missing name does not itself fail apply");
  for (const text of [
    "every call failed",
    "`WireResult.envelopes`",
    "`present` and `missing`",
    "`skipped`",
    "Missing\n  names alone do not fail apply; provider failures do",
    "including failed providers",
    "`--noWire` skips both the inventory check and\n  webhook stubs",
  ]) {
    expect(doc).toContain(text);
  }
});

test("checklist directs operators to identify dependencies and safely resolve uncertainty", () => {
  for (const text of [
    "scripts and runbooks",
    "`TODO_STACK_APPLY`",
    "saved wiring output",
    "`not in Phantom`",
    "`phantom add <NAME>`",
    "Do not pass the value as an argument",
    "skipped or failed wiring check is\n  unknown",
    "leave the check unresolved",
  ]) {
    expect(doc).toContain(text);
  }
  expect(doc).not.toMatch(/phantom add[^\n`]*TODO_STACK_APPLY/);
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    expect(existsSync(resolve(dirname(docPath), target)), `broken link: ${match[1]}`).toBe(true);
  }
});
