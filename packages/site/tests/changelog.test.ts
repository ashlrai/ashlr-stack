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
  expect(applyEntry).toContain("The wiring step does not write placeholder secrets.");

  const fixEntry = published.split("\n").find((line) => line.startsWith("- **`stack apply` stops writing"));
  expect(fixEntry).toContain("The wiring step never writes to the vault.");
  for (const entry of [applyEntry, fixEntry]) {
    expect(entry).toContain("you must supply the real value yourself");
    expect(entry).toContain("run `phantom add <NAME>` in a trusted terminal and enter the value when prompted");
  }
});
