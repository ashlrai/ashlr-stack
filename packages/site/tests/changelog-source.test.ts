import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

function releaseEntries(markdown: string, version: string): string[] {
  let inRelease = false;
  const entries: string[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      inRelease = token.depth === 2 && token.text.startsWith(`${version} —`);
    } else if (inRelease && token.type === "list") {
      entries.push(...token.items.map((item) => item.raw));
    }
  }
  return entries;
}

test("site changelog retains the apply wiring described for the 0.1.1 feature surface", () => {
  const changelog = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  expect(releaseEntries(changelog, "0.1.1").some((entry) => entry.includes("Same feature surface as the 0.1.0 tag"))).toBe(true);

  const applyEntries = releaseEntries(changelog, "0.1.0").filter((entry) =>
    entry.startsWith("- **`stack apply [recipe-id]`**"),
  );
  expect(applyEntries).toHaveLength(1);
  expect(applyEntries[0]).toContain("checks declared secret names");
  expect(applyEntries[0]).toContain("creates webhook stubs");
  expect(applyEntries[0]).toContain("Wiring no longer attempts to write placeholder values");

  // Removing the entry must leave no matching entry, even with other releases intact.
  expect(releaseEntries(changelog.replace(applyEntries[0], ""), "0.1.0").some((entry) =>
    entry.startsWith("- **`stack apply [recipe-id]`**"),
  )).toBe(false);
}, 30_000);
