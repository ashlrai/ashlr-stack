import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const path = join(root, "docs/apply-placeholder-upgrade-questions.md");
const doc = readFileSync(path, "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

test("upgrade guidance stays grounded in the changelog's historical and current behavior", () => {
  const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split("\n## ")[0] ?? "";
  const current = changelog.split("## Unreleased")[1]?.split("\n## ")[0] ?? "";
  expect(fix).toContain("every call failed");
  expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");
  expect(current).toContain("including providers that failed");
  expect(current).toContain("a missing name does not itself fail apply");
  expect(doc).toContain("Those calls failed; they did not create usable credentials");
  expect(doc).toContain("Provider setup is separate and may store real credentials");
  expect(doc).toContain("`WireResult.envelopes` was replaced by `present` and");
  expect(doc).toContain("including failed providers");
  expect(doc).toContain("A missing\nname alone does not fail apply; provider failures do");
});

test("the questionnaire distinguishes missing, unchecked, and unverified credentials", () => {
  for (const evidence of [
    "`not in Phantom` lists a required name",
    "`phantom-wire skipped`",
    "`phantom-wire failed`",
    "`--noWire` was used",
    "no provider succeeded",
    "Only name presence or a successful apply has been observed",
    "they do not prove that no secrets",
    "`phantom add <NAME>`",
    "Do not put the value in\ncommand arguments",
    "provider-specific signature verification",
  ]) {
    expect(doc).toContain(evidence);
  }
});

test("upgrade guidance links to its sources and local recovery guides", () => {
  expect(doc).toContain("](../CHANGELOG.md)");
  expect(doc).toContain("](apply-troubleshooting.md)");
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target === "" || /^[a-z]+:/.test(target)) continue;
    expect(existsSync(resolve(dirname(path), target)), `broken link: ${match[1]}`).toBe(true);
  }
});
