import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

/** Extract the first dated version heading (after `## Unreleased`) from a changelog. */
function latestVersionHeading(markdown: string): string {
  const HEADING = /^## (?!\s*$)/;
  for (const line of markdown.split("\n")) {
    if (HEADING.test(line)) {
      // Skip "## Unreleased" — we want the latest released version.
      if (!line.startsWith("## Unreleased")) {
        return line;
      }
    }
  }
  return "";
}

test("CHANGELOG.md and site CHANGELOG.md share the same latest version heading", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const site = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");

  const sourceHeading = latestVersionHeading(source);
  const siteHeading = latestVersionHeading(site);

  expect(sourceHeading).not.toBe("");
  expect(siteHeading).not.toBe("");
  expect(sourceHeading).toBe(siteHeading);
});
