import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const copies = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"] as const;

const entryFor = (text: string, release: string) => {
  const section = text.split(`\n## ${release}\n`)[1]?.split("\n## ")[0];
  const entry = section?.split("\n").find((line) => line.includes("`stack apply` stops attempting to write placeholder secrets"));
  return { section, entry };
};

for (const path of copies) {
  const text = readFileSync(join(root, path), "utf8");

  test(`${path}: the 0.2.1 \`stack apply\` entry describes stopping placeholder writes`, () => {
    const { section, entry } = entryFor(text, "0.2.1 (2026-10-16)");
    expect(section).toBeDefined();
    expect(entry).toBeDefined();
    expect(entry).toContain("never writes to the vault or fills in missing values");
    expect(entry).toContain("TODO_STACK_APPLY");
    expect(entry).toContain("phantom add <NAME>");
  });

  test(`${path}: the Unreleased \`stack apply\` entry says it creates no placeholder secrets`, () => {
    const { section } = entryFor(text, "Unreleased");
    expect(section).toContain("`stack apply` does not create placeholder secrets");
  });
}

test("both changelog copies carry the identical 0.2.1 placeholder-stop entry", () => {
  const [a, b] = copies.map((p) => entryFor(readFileSync(join(root, p), "utf8"), "0.2.1 (2026-10-16)").entry);
  expect(a).toBeDefined();
  expect(a).toBe(b);
});
