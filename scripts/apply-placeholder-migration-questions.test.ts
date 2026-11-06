import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const docPath = resolve(import.meta.dir, "../docs/apply-placeholder-migration-questions.md");
const doc = readFileSync(docPath, "utf8");
const normalized = doc.replace(/\s+/g, " ");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");

test("answers about the former behavior stay grounded in the changelog", () => {
  const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split(/^## /m)[0] ?? "";
  expect(fix).toContain("`phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`)");
  expect(fix).toContain("every call failed and the printed `envelopes` count was always 0");
  expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");
  expect(fix).toContain("never replaces a stored name");
  const publish = changelog.split("## 0.2.2 (2026-10-25)")[1]?.split(/^## /m)[0] ?? "";
  expect(publish).toContain("0.2.1 was tagged but its npm publish failed");
  for (const answer of [
    "`phantom add <KEY> TODO_STACK_APPLY --rotate`",
    "every call failed",
    "`envelopes` count was always 0",
    "`WireResult.envelopes` with `present` and `missing`",
    "npm publish failed",
    "Phantom never replaces a stored name",
    "did not create usable credentials",
  ]) {
    expect(normalized).toContain(answer);
  }
});

test("the document lists reader questions and bounds what the changelog does not answer", () => {
  const questions = [...doc.matchAll(/^## .+\?$/gm)].map((match) => match[0]);
  for (const question of [
    "What did the former wiring attempt?",
    "Did the attempts ever write a placeholder to the vault?",
    "Did the attempts rotate or overwrite stored secrets?",
    "What did the `envelopes` count report?",
    "Which release removed the attempts?",
    "Must I delete placeholder values apply left behind?",
  ]) {
    expect(questions).toContain(`## ${question}`);
  }
  const unanswered = (doc.split("## What does the changelog not answer?")[1] ?? "").replace(
    /\s+/g,
    " ",
  );
  expect(unanswered).toContain("`TODO_STACK_APPLY` value sits in a particular vault");
  expect(unanswered).toContain("not the exit status of those runs");
  expect(unanswered).toContain("does not establish what is installed");
  expect(normalized).toContain("`phantom add <NAME>` in a trusted terminal");
  expect(normalized).toContain("A missing name alone does not fail apply; provider failures do");
});

test("local links resolve", () => {
  expect(doc).toContain("](../CHANGELOG.md)");
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target && !/^[a-z]+:/.test(target)) {
      expect(existsSync(resolve(dirname(docPath), target)), match[1]).toBe(true);
    }
  }
});
