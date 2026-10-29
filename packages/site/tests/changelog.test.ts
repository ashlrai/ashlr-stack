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
  expect(applyEntry).toContain("Provider provisioning can store real values through `stack add`");
  expect(applyEntry).toContain("the wiring step never writes to the vault or creates placeholder secrets");
  expect(applyEntry).toContain("Missing secrets are reported for the operator to store with `phantom add <NAME>`");
  expect(applyEntry).toContain("providers whose vault check cannot run are reported as skipped");

  const fixEntry = published
    .split("\n")
    .find((line) => line.startsWith("- **`stack apply` stops writing placeholder secrets."));
  expect(fixEntry).toContain("The wiring step never writes to the vault; provider provisioning through `stack add` can store real values.");
  expect(fixEntry).toContain("If the vault cannot be read, the check reports providers as skipped rather than missing.");
});
