import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries, versionSections } from "./changelog-parser-utils";

const fixture = readFileSync(new URL("./__fixtures__/changelog-single-entry.md", import.meta.url), "utf8");

test("single-section, single-entry changelog yields the section and its entry once", () => {
  expect(sectionEntries(fixture)).toEqual([
    { version: "## 0.1.0 (2026-04-19)", section: "Added", entries: ["Only entry."] },
  ]);
  expect(versionSections(fixture)).toHaveLength(1);
});

test("site-style single-section fixture yields its one section and entry", () => {
  const site = readFileSync(new URL("./__fixtures__/changelog-site-single-section.md", import.meta.url), "utf8");
  expect(sectionEntries(site)).toEqual([
    {
      version: "## Unreleased",
      section: "Changed",
      entries: [
        "`stack apply` does not create placeholder secrets; supply required missing secrets as real values through Phantom (#1).",
      ],
    },
  ]);
  expect(versionSections(site)).toEqual([
    {
      heading: "## Unreleased",
      body: "\n### Changed\n\n- `stack apply` does not create placeholder secrets; supply required missing secrets as real values through Phantom (#1).\n\n",
    },
  ]);
});
