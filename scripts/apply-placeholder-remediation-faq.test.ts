import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const docPath = resolve(import.meta.dir, "../docs/apply-placeholder-remediation-faq.md");
const doc = readFileSync(docPath, "utf8");
const normalized = doc.replace(/\s+/g, " ");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");

test("remediation FAQ reflects the historical failure and operator action", () => {
  const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split(/^## /m)[0] ?? "";
  expect(fix).toContain("`phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`)");
  expect(fix).toContain("every call failed and the printed `envelopes` count was always 0");
  expect(normalized).toContain("every call failed. The old `envelopes` count was always 0");
  expect(normalized).toContain("run `phantom add <NAME>`, replacing `<NAME>` with the reported name");
  expect(normalized).toContain("enter the real value when prompted");
  expect(normalized).toContain("Missing names alone do not fail apply; provider failures do");
  expect(normalized).toContain("do not prove the vault is empty or complete");
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
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target && !/^[a-z]+:/.test(target)) {
      expect(existsSync(resolve(dirname(docPath), target)), match[1]).toBe(true);
    }
  }
});
