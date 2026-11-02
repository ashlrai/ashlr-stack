import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("maintenance guide identifies both copies and the historical apply sections", () => {
  const guide = read("docs/apply-changelog-maintenance.md");
  expect(guide).toContain("](../CHANGELOG.md)");
  expect(guide).toContain("](../packages/site/src/data/CHANGELOG.md)");
  expect(guide).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  expect(guide).toContain("bun run --cwd packages/site sync-content");
  expect(guide).toContain("packages/site/tests/changelog.test.ts scripts/apply-changelog.test.ts");

  for (const path of ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"]) {
    const changelog = read(path);
    for (const [release, markers] of [
      ["Unreleased", ["including providers that failed"]],
      ["0.3.0 (2026-10-31)", ["Apply wiring", "phantom-wire skipped"]],
      ["0.2.2 (2026-10-25)", ["missing recipe writes nothing", "keep going after a provider fails"]],
      ["0.2.1 (2026-10-16)", ["stops attempting to write placeholder secrets", "every call failed"]],
      ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", ["`stack apply [recipe-id]`", "TODO_STACK_APPLY"]],
    ] as const) {
      const section = changelog.split(`## ${release}\n`)[1]?.split("\n## ")[0];
      expect(section).toBeDefined();
      for (const marker of markers) expect(section).toContain(marker);
      expect(guide).toContain(release.split(" ")[0]);
    }
  }
});
