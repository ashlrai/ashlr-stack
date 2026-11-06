import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const guide = read("docs/changelog-mirroring.md");
const rootLog = read("CHANGELOG.md");
const siteLog = read("packages/site/src/data/CHANGELOG.md");
const ENTRY = "`stack apply` does not create placeholder secrets.";

function unreleasedChanged(log: string): string {
  const unreleased = log.split(/^## /m).find((s) => s.startsWith("Unreleased")) ?? "";
  return unreleased.split(/^### /m).find((s) => s.startsWith("Changed")) ?? "";
}

test("guide links both copies and tells maintainers to keep them consistent", () => {
  expect(guide).toContain("](../CHANGELOG.md)");
  expect(guide).toContain("](../packages/site/src/data/CHANGELOG.md)");
  expect(guide).toContain(ENTRY);
  expect(guide).toMatch(/Keep both copies consistent/);
});

test("the apply entry appears once in each copy under Unreleased → Changed", () => {
  for (const log of [rootLog, siteLog]) {
    expect(log.split(ENTRY)).toHaveLength(2);
    expect(unreleasedChanged(log)).toContain(ENTRY);
  }
});

test("both copies match byte for byte", () => {
  expect(siteLog).toBe(rootLog);
});
