import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

function releaseSection(markdown: string, version: string): string {
  return markdown.split(/^## /m).find((section) => section.startsWith(`${version} `)) ?? "";
}

function applyWiringEntry(markdown: string): string | undefined {
  return releaseSection(markdown, "0.1.0")
    .split("\n")
    .find((line) => line.startsWith("- **`stack apply [recipe-id]`**"));
}

test("0.1.1 inherits the documented apply wiring from 0.1.0", () => {
  expect(releaseSection(source, "0.1.1")).toContain("Same feature surface as the 0.1.0 tag");
  const entry = applyWiringEntry(source);
  expect(entry).toBeDefined();
  expect(entry).toContain("checks declared secret names");
  expect(entry).toContain("creates webhook stubs");
  expect(entry).toContain("`--noWire` opts out");
});

test("a missing historical apply entry is detected even if other releases mention apply", () => {
  const entry = applyWiringEntry(source);
  expect(entry).toBeDefined();
  const withoutEntry = source.replace(entry!, "");
  expect(withoutEntry).toContain("`stack apply`");
  expect(applyWiringEntry(withoutEntry)).toBeUndefined();
});
