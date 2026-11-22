import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readVault, setupFakePhantom } from "../packages/core/src/__tests__/_harness.ts";
import { wirePhantomForRecipe } from "../packages/core/src/ai/phantom-wire.ts";

const docPath = resolve(import.meta.dir, "../docs/apply-placeholder-migration.md");
const doc = readFileSync(docPath, "utf8");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");

test("migration examples match the changelog and local links resolve", () => {
  const examples = (text: string) =>
    [...text.matchAll(/```text\n([\s\S]*?)\n\s*```/g)].map((match) =>
      match[1]
        .split("\n")
        .map((line) => line.trim())
        .join("\n"),
    );
  expect(examples(doc)).toHaveLength(2);
  for (const sample of examples(doc)) expect(examples(changelog)).toContain(sample);
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target && !/^[a-z]+:/.test(target)) {
      expect(existsSync(resolve(dirname(docPath), target)), match[1]).toBe(true);
    }
  }
  expect(doc).toContain("Those calls failed");
  expect(doc).toContain("enter the real value when prompted");
});

// The migration questions were folded in from apply-placeholder-migration-questions.md
// and apply-migration-questions.md; these keep every assertion those docs' tests made.
const normalized = doc.replace(/\s+/g, " ");
const questionsSection = doc.split("## Migration questions")[1] ?? "";

function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s/g, "-");
}

test("migration answers about the former behavior stay grounded in the changelog", () => {
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
    "`phantom add <NAME>` in a trusted terminal",
    "A missing name alone does not fail apply; provider failures do",
    "`--noWire` skips both",
  ]) {
    expect(normalized).toContain(answer);
  }
});

test("migration questions are listed and bound what the changelog does not answer", () => {
  const questions = [...questionsSection.matchAll(/^### .+\?$/gm)].map((match) => match[0]);
  for (const question of [
    "What did the former wiring attempt?",
    "Did the attempts ever write a placeholder to the vault?",
    "Did the attempts rotate or overwrite stored secrets?",
    "What did the `envelopes` count report?",
    "Which release removed the attempts?",
    "Must I delete placeholder values apply left behind?",
    "Why does apply succeed while secrets are missing?",
    "What if the vault is unreadable?",
  ]) {
    expect(questions).toContain(`### ${question}`);
  }
  const unanswered = (doc.split("### What does the changelog not answer?")[1] ?? "").replace(
    /\s+/g,
    " ",
  );
  expect(unanswered).toContain("`TODO_STACK_APPLY` value sits in a particular vault");
  expect(unanswered).toContain("not the exit status of those runs");
  expect(unanswered).toContain("does not establish what is installed");
});

test("migration changelog anchors point at real headings", () => {
  const anchors = new Set(
    [...changelog.matchAll(/^## (.+)$/gm)].map((m) => slug(m[1].replace(/[[\]]/g, ""))),
  );
  const links = [...doc.matchAll(/\]\(\.\.\/CHANGELOG\.md#([^)]+)\)/g)].map((m) => m[1]);
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(anchors.has(link), link).toBe(true);
  expect(doc).toContain("](#migration-questions)");
  expect(doc).toMatch(/^## Migration questions$/m);
});

test("documented core result counts provider entries without writing values", async () => {
  const phantom = setupFakePhantom();
  const recipe = {
    id: "migration",
    query: "ai",
    createdAt: "2026-10-17T00:00:00.000Z",
    providers: [{ name: "openai" }, { name: "openai" }],
  };
  try {
    const result = await wirePhantomForRecipe(recipe, { cwd: phantom.dir });
    expect(result).toEqual({
      present: [],
      missing: ["openai:OPENAI_API_KEY", "openai:OPENAI_API_KEY"],
      webhooks: [],
      skipped: [],
    });
    expect(phantom.callsTo("add")).toEqual([]);
    expect(await readVault(phantom.dir)).toEqual({});
    expect(await wirePhantomForRecipe(recipe, { cwd: phantom.dir, noWire: true })).toEqual({
      present: [],
      missing: [],
      webhooks: [],
      skipped: [],
    });
    expect(phantom.callsTo("list")).toHaveLength(1);
    expect(doc).toContain("Repeated providers can produce repeated entries");
    expect(doc).toContain("that result means wiring was disabled");
  } finally {
    phantom.cleanup();
  }
});
