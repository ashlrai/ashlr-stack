import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("apply placeholder-removal entry has the same heading in both changelogs", () => {
  const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
  const headings = paths.map((path) => {
    const changelog = readFileSync(join(import.meta.dir, "..", path), "utf8");
    const entries = changelog
      .split("\n")
      .filter((line) => line.includes("The wiring step never writes to the vault or fills in missing values."));
    expect(entries).toHaveLength(1);
    const heading = entries[0]?.match(/^- \*\*(.+?)\*\*/)?.[1];
    expect(heading).toBeDefined();
    return heading;
  });

  expect(headings[0]).toBe(headings[1]);
});
