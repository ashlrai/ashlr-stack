import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const placeholderRemovalHeading = "- **`stack apply` stops writing placeholder secrets.**";

function missingPlaceholderRemovalEntries(source: string, published: string): string[] {
  return [
    ["CHANGELOG.md", source],
    ["packages/site/src/data/CHANGELOG.md", published],
  ]
    .filter(([, changelog]) => !changelog.split("\n").some((line) => line.startsWith(placeholderRemovalHeading)))
    .map(([path]) => path);
}

test("both changelogs include the apply placeholder-removal entry", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(missingPlaceholderRemovalEntries(source, published)).toEqual([]);
});

test.each([
  [placeholderRemovalHeading, "", ["packages/site/src/data/CHANGELOG.md"]],
  ["", placeholderRemovalHeading, ["CHANGELOG.md"]],
  ["", "", ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"]],
  [placeholderRemovalHeading, placeholderRemovalHeading, []],
])("placeholder-removal check reports each missing copy", (source, published, missing) => {
  expect(missingPlaceholderRemovalEntries(source, published)).toEqual(missing);
});

test("site changelog mirrors the source and explains apply's placeholder behavior", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(published).toBe(source);

  const applyEntry = published
    .split("\n")
    .find((line) => line.startsWith("- **`stack apply [recipe-id]`**"));
  expect(applyEntry).toContain("The wiring step does not write placeholder secrets.");

  const fixEntry = published.split("\n").find((line) => line.startsWith("- **`stack apply` stops writing"));
  expect(fixEntry).toContain("The wiring step never writes to the vault or fills in missing values.");
  expect(fixEntry).toContain("Provider setup may already store real values");
  expect(fixEntry).toContain("users must supply each required missing value themselves");
  expect(fixEntry).toContain("it reports providers as skipped instead of identifying missing names");
  expect(applyEntry).toContain("Users must supply each required missing value");
  for (const entry of [applyEntry, fixEntry])
    expect(entry).toContain("run `phantom add <NAME>` from a trusted terminal and enter the real value");
});
