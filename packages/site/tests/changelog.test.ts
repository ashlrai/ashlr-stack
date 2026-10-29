import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");

function checkChangelogs(source: string, published: string) {
  expect(published).toBe(source);

  const applyEntry = published
    .split("\n")
    .find((line) => line.startsWith("- **`stack apply [recipe-id]`**"));
  expect(applyEntry).toContain("The wiring step does not write placeholder secrets.");

  const fixEntry = published.split("\n").find((line) => line.startsWith("- **`stack apply` stops writing"));
  expect(fixEntry).toContain("The wiring step never writes to the vault.");
  for (const entry of [applyEntry, fixEntry]) {
    expect(entry).toContain("Users must supply each required missing value");
    expect(entry).toContain("run `phantom add <NAME>` from a trusted terminal and enter the real value");
  }
}

test("site changelog mirrors the source and explains apply's placeholder behavior", () => {
  checkChangelogs(source, published);
});

test("the changelog check rejects a missing placeholder-removal note in either or both copies", () => {
  const removeNote = (text: string) =>
    text
      .split("\n")
      .filter((line) => !line.startsWith("- **`stack apply` stops writing"))
      .join("\n");
  const sourceWithoutNote = removeNote(source);
  const publishedWithoutNote = removeNote(published);

  expect(() => checkChangelogs(sourceWithoutNote, published)).toThrow();
  expect(() => checkChangelogs(source, publishedWithoutNote)).toThrow();
  expect(() => checkChangelogs(sourceWithoutNote, publishedWithoutNote)).toThrow();
});

test("the changelog check rejects conflicting or incomplete placeholder behavior", () => {
  const altered = published.replace("The wiring step never writes to the vault.", "The wiring step writes to the vault.");
  const withoutGuidance = published.replace(
    "Users must supply each required missing value: run `phantom add <NAME>` from a trusted terminal and enter the real value.",
    "",
  );

  expect(() => checkChangelogs(source, altered)).toThrow();
  expect(() => checkChangelogs(altered, altered)).toThrow();
  expect(() => checkChangelogs(withoutGuidance, withoutGuidance)).toThrow();
});
