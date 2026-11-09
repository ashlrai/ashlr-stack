import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const doc = readFileSync(new URL("../docs/apply-placeholder-removal.md", import.meta.url), "utf8");
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

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

test("current apply description says missing values require user action", () => {
  const description = changelog.split("- **`stack apply [recipe-id]`**")[1]?.split("\n")[0];
  expect(description).toBeDefined();
  expect(description).toContain("does not write to the vault or fill in missing values");
  expect(description).toContain("Users must supply each required missing value");
});
