import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const docPath = resolve(root, "docs/apply-changelog-audience-note.md");
const doc = readFileSync(docPath, "utf8");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"] as const;

test("note links each cited apply entry and the sections support its claims", () => {
  for (const [heading, fragment, evidence] of [
    [
      "0.1.0 — 2026-04-19 (superseded by 0.1.1)",
      "010--2026-04-19-superseded-by-011",
      "attempted to write a `TODO_STACK_APPLY` placeholder",
    ],
    [
      "0.2.1 (2026-10-16)",
      "021-2026-10-16",
      "`stack apply` stops attempting to write placeholder secrets",
    ],
    ["0.2.2 (2026-10-25)", "022-2026-10-25", "its npm publish failed"],
    [
      "0.3.0 (2026-10-31)",
      "030-2026-10-31",
      "not proof that every required secret is present",
    ],
    ["Unreleased", "unreleased", "including providers that failed"],
  ] as const) {
    expect(doc, `link to ${heading}`).toContain(`](../CHANGELOG.md#${fragment})`);
    for (const source of sources) {
      const changelog = readFileSync(resolve(root, source), "utf8");
      const section = changelog.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
      expect(section, `${source}: ${heading}`).toBeDefined();
      expect(section, `${source}: ${heading}`).toContain(evidence);
    }
  }
});

test("note states the previous and current documented behavior accurately", () => {
  for (const phrase of [
    "previous `stack apply` wiring",
    "`phantom add <KEY> TODO_STACK_APPLY\n--rotate`",
    "refuses values in command arguments",
    "always 0",
    "never writes to the\nvault or fills missing values",
    "`WireResult.envelopes` is replaced by\n`present` and `missing`",
    "`skipped` instead of identifying missing names",
    "`phantom add <NAME>` in a trusted terminal",
    "names alone do not make apply fail",
    "provider failures do",
    "webhook stubs even when the vault is unreadable",
    "both checks and stubs",
    "npm publish failed",
  ]) {
    expect(doc).toContain(phrase);
  }
});

test("note keeps the historical commands marked as non-runnable and scoped", () => {
  const all = doc.match(/TODO_STACK_APPLY/g) ?? [];
  const codified = doc.match(/`[^`]*TODO_STACK_APPLY[^`]*`/g) ?? [];
  expect(codified.length).toBe(all.length);
  for (const phrase of [
    "historical, not instructions to run",
    "not the version installed",
    "`stack apply --help`",
  ]) {
    expect(doc).toContain(phrase);
  }
});

test("note's relative links resolve", () => {
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    expect(existsSync(resolve(dirname(docPath), target)), `broken link: ${match[1]}`).toBe(true);
  }
});
