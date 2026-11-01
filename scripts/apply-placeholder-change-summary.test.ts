import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const summary = readFileSync(new URL("../docs/apply-placeholder-change-summary.md", import.meta.url), "utf8");
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

test("placeholder change summary links to and reflects the source entry", () => {
  const section = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split("\n## ")[0];
  expect(section).toBeDefined();
  expect(summary).toContain("](../CHANGELOG.md#021-2026-10-16)");
  for (const detail of [
    "phantom add <KEY> TODO_STACK_APPLY --rotate",
    "phantom list --json",
    "phantom add <NAME>",
    "WireResult.envelopes",
    "present",
    "missing",
    "skipped",
  ]) {
    expect(section).toContain(detail);
    expect(summary).toContain(detail);
  }
  expect(summary).toContain("without `--rotate`");
  expect(summary).toContain("Both attempts");
  expect(summary).toContain("never\nwrites to the vault or fills missing values");
  expect(summary).toContain("Provider setup may separately store real values");
});
