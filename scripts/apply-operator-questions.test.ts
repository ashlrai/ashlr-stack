import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const path = resolve(import.meta.dir, "../docs/apply-operator-questions.md");
const doc = readFileSync(path, "utf8");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");

test("operator worksheet separates documented behavior from decisions", () => {
  const [facts, questions] = doc.split("## Questions to resolve");
  expect(facts).toContain("## Documented facts");
  expect(changelog.split("## Unreleased")[1]?.split("\n## ")[0]).toContain(
    "including providers that failed",
  );
  for (const topic of [
    "including failed providers",
    "provider failures do",
    "`--noWire` skips",
    "vault is unreadable",
  ]) {
    expect(facts).toContain(topic);
  }
  for (const topic of [
    "Which version and projects are affected?",
    "Did every provider succeed?",
    "Was the inventory actually checked?",
    "Which missing names are required in this environment?",
    "Do the credentials and services work?",
    "Are webhook files safe and ready?",
    "Do automation or core consumers need changes?",
  ]) {
    expect(questions).toContain(topic);
  }
  expect(questions).toContain("`phantom add <NAME>`");
  expect(questions).toContain("unknown, not empty");
  expect(questions).toContain("provider-specific signature validation");
});

test("worksheet links to available evidence and recovery guidance", () => {
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    expect(existsSync(resolve(dirname(path), match[1])), `broken link: ${match[1]}`).toBe(true);
  }
  expect(doc).toContain("](../CHANGELOG.md)");
  expect(doc).toContain("](apply-troubleshooting.md)");
});
