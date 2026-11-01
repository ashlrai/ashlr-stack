import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const docPath = resolve(import.meta.dir, "../docs/apply-placeholder-operator-impact.md");
const doc = readFileSync(docPath, "utf8");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");
const examples = (text: string) =>
  [...text.matchAll(/```text\n([\s\S]*?)\n\s*```/g)].map((match) =>
    match[1]
      .split("\n")
      .map((line) => line.trim())
      .join("\n"),
  );

test("operator examples come from the changelog and local links resolve", () => {
  expect(examples(doc)).toHaveLength(2);
  for (const example of examples(doc)) expect(examples(changelog)).toContain(example);
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target) expect(existsSync(resolve(dirname(docPath), target)), match[1]).toBe(true);
  }
});

test("operator guidance preserves the changelog's uncertainty and scope", () => {
  expect(changelog).toContain("including providers that failed");
  expect(doc).toContain("including failed providers");
  expect(changelog).toContain("a missing name does not itself fail apply, while provider failures do");
  expect(doc).toContain("not fail apply; provider failures do");
  expect(doc).toContain("are **unknown** from the\nchangelog");
  expect(doc).toContain("does not prescribe a downstream\nmigration procedure");
  expect(doc).toContain("`--noWire` skips both the name checks and");
  expect(doc).not.toMatch(/phantom add[^\n`]*TODO_STACK_APPLY/);
});
