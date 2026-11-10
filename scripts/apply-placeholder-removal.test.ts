import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const doc = readFileSync(new URL("../docs/apply-placeholder-removal.md", import.meta.url), "utf8");
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const siteChangelog = readFileSync(new URL("../packages/site/src/data/CHANGELOG.md", import.meta.url), "utf8");

test("placeholder removal doc links to and reflects the changelog entry", () => {
  const section = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split("\n## ")[0];
  expect(section).toBeDefined();
  expect(doc).toContain("](../CHANGELOG.md#021-2026-10-16)");
  for (const detail of [
    "phantom add <KEY> TODO_STACK_APPLY --rotate",
    "phantom list --json",
    "phantom add <NAME>",
    "WireResult.envelopes",
    "not in Phantom:",
    "skipped",
    "--noWire",
  ]) {
    expect(doc).toContain(detail);
  }
  for (const detail of ["phantom add <KEY> TODO_STACK_APPLY --rotate", "phantom list --json", "WireResult.envelopes"]) {
    expect(section).toContain(detail);
  }
});

test("placeholder removal doc recommends no placeholder values", () => {
  // The only placeholder token allowed is the historical one, labelled as not to run.
  expect(doc.match(/TODO_STACK_APPLY/g)?.length).toBe(1);
  expect(doc).toContain("historical, not\ninstructions to run");
  expect(doc).toContain("enter the real value");
  // Every `phantom add` form other than the historical one takes only a name.
  const forms = doc.replace(/\s+/g, " ").match(/phantom add <\w+>(?: \S+)?/g) ?? [];
  expect(forms.filter((f) => f !== "phantom add <NAME>" && !f.startsWith("phantom add <KEY> TODO_STACK_APPLY"))).toEqual([]);
});

test("changelog presents the placeholder command only as history, never as a setup step", () => {
  // `phantom add <KEY> TODO_STACK_APPLY` is the retired wiring command. Every
  // mention in either changelog must describe removed behavior: framed as
  // history and never phrased as an instruction to run.
  const command = /phantom add <KEY> TODO_STACK_APPLY/g;
  for (const [name, text] of [
    ["CHANGELOG.md", changelog],
    ["packages/site/src/data/CHANGELOG.md", siteChangelog],
  ] as const) {
    const matches = [...text.matchAll(command)];
    expect(matches.length, `${name} should still record the historical command`).toBeGreaterThan(0);
    for (const match of matches) {
      const start = match.index ?? 0;
      const context = text.slice(Math.max(0, start - 400), start + match[0].length + 200);
      expect(context, `${name} mention at offset ${start} lacks historical framing`).toMatch(
        /Previously|Historically|historical|attempted|failed|removed|stops attempting|no longer/i,
      );
      expect(context, `${name} mention at offset ${start} reads as a current instruction`).not.toMatch(
        /\b(?:run|execute|enter|type|use|store)\b[^.\n]{0,40}phantom add <KEY> TODO_STACK_APPLY/i,
      );
    }
  }
});

test("current apply description says missing values require user action", () => {
  const description = changelog.split("- **`stack apply [recipe-id]`**")[1]?.split("\n")[0];
  expect(description).toBeDefined();
  expect(description).toContain("does not write to the vault or fill in missing values");
  expect(description).toContain("Users must supply each required missing value");
});
