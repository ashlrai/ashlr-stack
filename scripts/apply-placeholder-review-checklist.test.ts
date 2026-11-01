import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const path = resolve(import.meta.dir, "../docs/apply-placeholder-review-checklist.md");
const doc = readFileSync(path, "utf8");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");

test("review guidance reflects the historical failure and current name checks", () => {
  expect(changelog).toContain("every call failed");
  expect(changelog).toContain("a missing name does not itself fail apply");
  for (const text of [
    "every attempt failed",
    "checks\nnames without filling values",
    "including failed\n  providers",
    "Missing names alone do not fail apply; provider failures do",
    "`--noWire`",
    "Unknown providers are also skipped",
    "present but\n  unverified, confirmed placeholder, or verified usable",
    "`not in Phantom` means missing",
  ]) expect(doc).toContain(text);
});

test("review and replacement protect values and avoid treating presence as proof", () => {
  for (const text of [
    "do not record or share values",
    "A present name is\n  not evidence of a valid credential",
    "do not assume a value is a placeholder",
    "`phantom remove <NAME>`",
    "`phantom add <NAME>`",
    "Removal leaves the name unavailable until it is re-added",
    "do not remove an\n  unverified or working credential",
    "verify provider access and application behavior without exposing the value",
    "Do not rerun apply just to inspect the vault",
  ]) expect(doc).toContain(text);
  expect(doc).not.toMatch(/phantom add[^\n`]*TODO_STACK_APPLY/);
});

test("local documentation links resolve", () => {
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target && !/^[a-z]+:/.test(target)) {
      expect(existsSync(resolve(dirname(path), target)), `broken link: ${match[1]}`).toBe(true);
    }
  }
});
