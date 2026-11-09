import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries, versionSections } from "./changelog-parser-utils";

const fixture = readFileSync(new URL("./__fixtures__/changelog-two-section-order.md", import.meta.url), "utf8");

test("two sections and their entries keep source order (not alphabetical)", () => {
  expect(sectionEntries(fixture)).toEqual([
    { version: "## 0.4.0 (2026-11-03)", section: "Fixed", entries: ["Fixed first.", "Fixed second."] },
    { version: "## 0.4.0 (2026-11-03)", section: "Added", entries: ["Added first.", "Added second."] },
  ]);
});

test("two-section fixture is one version whose body lists Fixed before Added", () => {
  const sections = versionSections(fixture);
  expect(sections).toHaveLength(1);
  const { body } = sections[0];
  expect(body.indexOf("### Fixed")).toBeGreaterThanOrEqual(0);
  expect(body.indexOf("### Fixed")).toBeLessThan(body.indexOf("### Added"));
});

test("two entries in one section keep source order (not alphabetical)", () => {
  const md = ["## Unreleased", "", "### Added", "", "- Zebra support.", "- Apple support.", ""].join("\n");
  expect(sectionEntries(md)).toEqual([
    { version: "## Unreleased", section: "Added", entries: ["Zebra support.", "Apple support."] },
  ]);
});
