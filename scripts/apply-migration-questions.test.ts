import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const docPath = resolve(import.meta.dir, "../docs/apply-migration-questions.md");
const doc = readFileSync(docPath, "utf8");
const normalized = doc.replace(/\s+/g, " ");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");

function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s/g, "-");
}

test("lists operator questions grounded in the changelog", () => {
  const questions = [...doc.matchAll(/^## .+\?$/gm)].map((m) => m[0]);
  expect(questions.length).toBeGreaterThanOrEqual(6);
  const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split(/^## /m)[0] ?? "";
  expect(fix).toContain("TODO_STACK_APPLY");
  expect(fix).toContain("`envelopes` count was always 0");
  expect(normalized).toContain("`envelopes` count was always 0");
  expect(normalized).toContain("`phantom add <NAME>` in a trusted terminal");
  expect(normalized).toContain("A missing name alone does not fail apply; provider failures do");
  expect(normalized).toContain("`--noWire` skips both");
});

test("changelog anchors point at real headings", () => {
  const anchors = new Set(
    [...changelog.matchAll(/^## (.+)$/gm)].map((m) => slug(m[1].replace(/[[\]]/g, ""))),
  );
  const links = [...doc.matchAll(/\]\(\.\.\/CHANGELOG\.md#([^)]+)\)/g)].map((m) => m[1]);
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(anchors.has(link), link).toBe(true);
});

test("local links resolve", () => {
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target && !/^[a-z]+:/.test(target)) {
      expect(existsSync(resolve(dirname(docPath), target)), match[1]).toBe(true);
    }
  }
});
