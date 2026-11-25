import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// docs/apply-placeholder-operator-checklist.md absorbed the former operator
// check and operator impact docs. packages/core and packages/cli tests also
// read it, so keep the missing-name example as its first ```text block.
const docPath = resolve(import.meta.dir, "../docs/apply-placeholder-operator-checklist.md");
const doc = readFileSync(docPath, "utf8");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");

// Check across wrapped lines and shell continuations, while keeping separately
// backtick-delimited commands and historical marker mentions apart.
const placeholderCommand = /\bphantom\s+add\b[^`]*\bTODO_STACK_APPLY\b/;

function examples(text: string): string[] {
  return [...text.matchAll(/```text\n([\s\S]*?)\n\s*```/g)].map((match) =>
    match[1]
      .split("\n")
      .map((line) => line.trim())
      .join("\n"),
  );
}

describe("apply placeholder operator checklist", () => {
  it("keeps the current operator guidance free of placeholder write commands", () => {
    expect(doc).not.toMatch(placeholderCommand);
  });

  it.each([
    "`phantom add OPENAI_API_KEY TODO_STACK_APPLY`",
    "`phantom add OPENAI_API_KEY 'TODO_STACK_APPLY' --rotate`",
    "```sh\nphantom\tadd OPENAI_API_KEY TODO_STACK_APPLY\n```",
    "~~~bash\nphantom  add OPENAI_API_KEY TODO_STACK_APPLY\n~~~",
    "    phantom add OPENAI_API_KEY TODO_STACK_APPLY",
    "```bash\nphantom add OPENAI_API_KEY \\\n  TODO_STACK_APPLY\n```",
  ])("detects an unsafe command added to the current guidance: %s", (command) => {
    expect(`${doc}\n${command}`).toMatch(placeholderCommand);
  });

  it("allows prompted entry alongside a separate historical marker mention", () => {
    expect("Run `phantom add OPENAI_API_KEY`; never enter `TODO_STACK_APPLY`.").not.toMatch(
      placeholderCommand,
    );
  });

  it("uses the changelog's missing and unreadable inventory examples", () => {
    const samples = examples(doc);
    expect(samples).toHaveLength(2);
    const sourceSamples = examples(changelog);
    for (const sample of samples) expect(sourceSamples).toContain(sample);
    expect(samples[0]).toContain("not in Phantom: OPENAI_API_KEY");
    expect(samples[1]).toContain("phantom-wire skipped: openai");
  });

  it("resolves every local link", () => {
    for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (target) expect(existsSync(resolve(dirname(docPath), target)), match[1]).toBe(true);
    }
  });

  it("identifies the historical failure without giving a command to create a placeholder", () => {
    expect(changelog).toContain("TODO_STACK_APPLY --rotate");
    expect(doc).toContain("`TODO_STACK_APPLY`");
    expect(doc).toContain("old `envelopes` count was\n  always 0");
    expect(doc).toContain("Do not create placeholder values");
    expect(doc).not.toMatch(/phantom add[^\n`]*TODO_STACK_APPLY/);
    expect(doc).toContain("entering\nthe real value when prompted");
  });

  it("preserves the changelog's uncertainty and scope", () => {
    expect(changelog).toContain("including providers that failed");
    expect(doc).toContain("including failed providers");
    expect(changelog).toContain(
      "a missing name does not itself fail apply, while provider failures do",
    );
    expect(doc).toContain("not fail apply; provider failures do");
    expect(doc).toContain("are **unknown** from the\nchangelog");
    expect(doc).toContain("does not prescribe a downstream\nmigration procedure");
    expect(doc).toContain("`--noWire` skips both name checks and webhook stubs");
  });
});
