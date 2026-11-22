import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// The FAQ absorbed the former remediation FAQ and upgrade questionnaire, so
// this file carries the assertions from all three.
const docPath = resolve(import.meta.dir, "../docs/apply-placeholder-faq.md");
const doc = readFileSync(docPath, "utf8");
const faq = doc.replace(/\s+/g, " ");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");
const section = (heading: string) => changelog.split(heading)[1]?.split(/^## /m)[0] ?? "";

test("the FAQ distinguishes the historical rotation attempt from its result", () => {
  const fix = section("## 0.2.1 (2026-10-16)");
  expect(fix).toContain("`phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`)");
  expect(fix).toContain("has no `--rotate`, so every call failed");
  expect(fix).toContain("every call failed and the printed `envelopes` count was always 0");
  expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");
  expect(faq).toContain("../CHANGELOG.md#021-2026-10-16");
  expect(faq).toContain("`phantom add <KEY> TODO_STACK_APPLY --rotate`, then retried without `--rotate`");
  expect(faq).toContain("every call failed. The attempted option did not rotate secrets");
  expect(faq).toContain("The old `envelopes` count was always 0");
  expect(faq).toContain("does not establish the state of an individual vault or prescribe a migration");
  expect(faq).toContain("`WireResult.envelopes` field was replaced by `present` and `missing`");
});

test("the FAQ stays grounded in the changelog's current behavior", () => {
  const current = section("## Unreleased");
  expect(current).toContain("including providers that failed");
  expect(current).toContain("a missing name does not itself fail apply");
  expect(faq).toContain("Those calls failed; they did not create usable credentials");
  expect(faq).toContain("Provider setup is separate and may store real credentials");
  expect(faq).toContain("including failed providers");
  expect(faq).toContain("Missing names alone do not fail apply; provider failures do");
  expect(faq).toContain("run `phantom add <NAME>`, replacing `<NAME>` with the reported name");
  expect(faq).toContain("enter the real value when prompted");
  expect(faq).toContain("Do not put the value in command arguments");
  expect(faq).toContain("do not prove the vault is empty or complete");
});

test("the questionnaire distinguishes missing, unchecked, and unverified credentials", () => {
  for (const evidence of [
    "`not in Phantom` lists a required name",
    "`phantom-wire skipped`",
    "`phantom-wire failed`",
    "`--noWire` was used",
    "no provider succeeded",
    "Only name presence or a successful apply has been observed",
    "provider-specific signature verification",
  ]) {
    expect(faq).toContain(evidence);
  }
});

test("FAQ examples match the changelog and local links resolve", () => {
  const examples = (text: string) =>
    [...text.matchAll(/```text\n([\s\S]*?)\n\s*```/g)].map((match) =>
      match[1]
        .split("\n")
        .map((line) => line.trim())
        .join("\n"),
    );
  expect(examples(doc)).toHaveLength(2);
  for (const example of examples(doc)) expect(examples(changelog)).toContain(example);
  expect(doc).toContain("](apply-troubleshooting.md)");
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target && !/^[a-z]+:/.test(target)) {
      expect(existsSync(resolve(dirname(docPath), target)), `broken link: ${match[1]}`).toBe(true);
    }
  }
});
