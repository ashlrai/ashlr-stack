import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const comparison = readFileSync(join(root, "docs/changelog-apply-comparison.md"), "utf8");
const copies = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const title = "- **`stack apply` stops attempting to write placeholder secrets.**";

function matchingApplyEntries(changelogs: string[]): string {
  const entries = changelogs.map((changelog, index) => {
    const release = changelog.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
    const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
    const entries = fixes?.split("\n").filter((line) => line.startsWith(title));
    expect(entries, copies[index]).toHaveLength(1);
    expect(fixes?.trimStart().startsWith(title), copies[index]).toBe(true);
    return entries?.[0] ?? "";
  });
  expect(entries[0]).toBe(entries[1]);
  return entries[0];
}

test("comparison cites the same complete 0.2.1 apply fix in both changelogs", () => {
  const changelogs = copies.map((path) => {
    expect(comparison).toContain(`](../${path}#021-2026-10-16)`);
    return readFileSync(join(root, path), "utf8");
  });
  const entry = matchingApplyEntries(changelogs);
  expect(changelogs[0]).toBe(changelogs[1]);
  expect(comparison).toContain("**Wording differences: none.**");
  expect(comparison).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  for (const claim of [
    "The wiring step never writes to the vault or fills in missing values.",
    "Provider setup may already store real values",
    "users must supply each required missing value themselves",
    "phantom list --json",
    "reports providers as skipped instead of identifying missing names",
    "every call failed and the printed `envelopes` count was always 0",
    "`WireResult.envelopes` is replaced by `present` and `missing`",
  ]) {
    expect(entry).toContain(claim);
  }
  for (const topic of [
    "Wiring and setup",
    "Required values",
    "Readable vault",
    "Unreadable vault",
    "Previous behavior",
    "Result fields",
  ]) {
    expect(comparison).toContain(`| ${topic} |`);
  }
});

test("the entry comparison detects wording-only differences in either changelog", () => {
  const changelogs = copies.map((path) => readFileSync(join(root, path), "utf8"));
  const wording = "Provider setup may already store real values";
  for (const index of [0, 1]) {
    const changed = [...changelogs];
    expect(changed[index]).toContain(wording);
    changed[index] = changed[index].replace(wording, "Provider setup can already store real values");
    expect(() => matchingApplyEntries(changed)).toThrow();
  }
});

test("the entry comparison detects a behavior mismatch in either changelog", () => {
  const changelogs = copies.map((path) => readFileSync(join(root, path), "utf8"));
  const behavior = "The wiring step never writes to the vault or fills in missing values.";
  const contradiction = "The wiring step writes placeholder values to the vault.";

  for (const index of [0, 1]) {
    const changed = [...changelogs];
    expect(changed[index]).toContain(behavior);
    changed[index] = changed[index].replace(behavior, contradiction);
    expect(() => matchingApplyEntries(changed)).toThrow();
  }
});
