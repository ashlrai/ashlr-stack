import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { malformedHeadings, sectionEntries, versionBodies, versionSections } from "./changelog-parser-utils";

const fixture = readFileSync(new URL("./__fixtures__/changelog-versionless-entries.md", import.meta.url), "utf8");

test("a version with no entries is listed, with an empty body and no invented sections", () => {
  expect(malformedHeadings(fixture)).toEqual([]);
  expect(versionSections(fixture).map((s) => s.heading)).toEqual([
    "## Unreleased",
    "## 0.3.1 (2026-11-02)",
    "## 0.3.0 (2026-10-31)",
  ]);
  expect(versionBodies(fixture).get("## 0.3.1 (2026-11-02)")?.trim()).toBe("");
});

test("entries stay with their own versions; the empty version owns none", () => {
  const rows = sectionEntries(fixture);
  expect(rows).toEqual([
    { version: "## Unreleased", section: "Fixed", entries: ["Fleet JSONL reads enforce the byte cap while reading."] },
    { version: "## 0.3.0 (2026-10-31)", section: "Added", entries: ["Fleet diagnostics: lanes, supply, latency and lag."] },
  ]);
  expect(rows.some((r) => r.version.startsWith("## 0.3.1"))).toBe(false);
});
