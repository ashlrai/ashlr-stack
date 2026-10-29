import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");

test("site changelog mirrors the source and explains apply's placeholder behavior", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(published).toBe(source);

  const applyEntry = published
    .split("\n")
    .find((line) => line.startsWith("- **`stack apply [recipe-id]`**"));
  expect(applyEntry).toContain("no longer writes `TODO_STACK_APPLY` as a placeholder secret");
  expect(applyEntry).toContain("for each reported missing secret, run `phantom add <NAME>`");
  expect(applyEntry).toContain("from a trusted terminal and enter the real value");

  const fixEntry = published.split("\n").find((line) => line.startsWith("- **`stack apply` stops writing"));
  expect(fixEntry).toContain("For each missing name, run `phantom add <NAME>`");
  expect(fixEntry).toContain("from a trusted terminal and enter the real value");
});
