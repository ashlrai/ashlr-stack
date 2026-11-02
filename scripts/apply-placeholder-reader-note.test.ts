import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const note = readFileSync(new URL("../docs/apply-placeholder-reader-note.md", import.meta.url), "utf8");
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

test("reader note identifies the historical command and reflects the changelog fix", () => {
  const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split("\n## ")[0];
  expect(fix).toBeDefined();
  expect(note).toContain("](../CHANGELOG.md#021-2026-10-16)");
  for (const detail of [
    "phantom add <KEY> TODO_STACK_APPLY --rotate",
    "phantom list --json",
    "phantom add <NAME>",
    "WireResult.envelopes",
  ]) {
    expect(fix).toContain(detail);
    expect(note).toContain(detail);
  }
  const text = note.replace(/\s+/g, " ");
  expect(text).toContain("historical attempt");
  expect(text).toContain("These are not commands to run");
  expect(text).toContain("Both attempts failed");
  expect(text).toContain("stopped wiring from attempting to write placeholder secrets");
  expect(text).toContain("does not write to the vault or fill missing values");
  expect(text).toContain("reports providers as skipped instead of identifying missing names");
  expect(text).toContain("provider setup may store real values separately");
  expect(text).toContain("in a trusted terminal and enter the real value");
});

test("reader note distinguishes the unpublished 0.2.1 tag from 0.2.2", () => {
  const release = changelog.split("## 0.2.2 (2026-10-25)")[1]?.split("\n## ")[0];
  expect(release).toContain("0.2.1 was tagged but its npm publish failed");
  expect(release).toContain("0.2.2 supersedes it: it ships everything listed here and under 0.2.1");
  expect(note).toContain("](../CHANGELOG.md#022-2026-10-25)");
  expect(note.replace(/\s+/g, " ")).toContain("0.2.1 was tagged but not published to npm");
  expect(note).toContain("0.2.2 includes its changes");
});
