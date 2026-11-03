import { expect, test } from "bun:test";
import { malformedHeadings, sectionEntries, versionSections } from "./changelog-parser-utils";
import { readFileSync } from "node:fs";

const fixture = readFileSync(new URL("./__fixtures__/changelog-crlf.md", import.meta.url), "utf8");

type Version = { heading: string; sections: Map<string, string[]> };

/** Parse semver `##` versions, their `###` sections and `- ` entries; accepts LF or CRLF. */
function parse(md: string): Version[] {
  const versions: Version[] = [];
  let section: string[] | null = null;
  for (const line of md.split(/\r?\n/)) {
    if (/^##(?!#)/.test(line)) {
      section = null;
      if (/^## +\[?\d+\.\d+\.\d+/.test(line)) versions.push({ heading: line, sections: new Map() });
    } else if (/^###(?!#) /.test(line) && versions.length) {
      section = [];
      versions[versions.length - 1]?.sections.set(line.slice(4).trim(), section);
    } else if (section && line.startsWith("- ")) {
      section.push(line.slice(2));
    }
  }
  return versions;
}

test("fixture uses CRLF for every line break", () => {
  expect(fixture.includes("\r\n")).toBe(true);
  expect(fixture.replace(/\r\n/g, "").includes("\n")).toBe(false);
});

test("versions, sections and entries parse with CRLF endings", () => {
  const versions = parse(fixture);
  expect(versions.map((v) => v.heading)).toEqual(["## 0.2.0 (2026-05-01)", "## 0.1.0 (2026-04-19)"]);
  expect([...(versions[0]?.sections ?? [])]).toEqual([["Added", ["Second version entry."]]]);
  expect([...(versions[1]?.sections ?? [])]).toEqual([["Fixed", ["First version entry."]]]);
});

test("CRLF and LF fixtures parse identically", () => {
  expect(parse(fixture.replace(/\r\n/g, "\n"))).toEqual(parse(fixture));
});

test("shared parser utils return identical results for CRLF and LF", () => {
  const lf = fixture.replace(/\r\n/g, "\n");
  expect(sectionEntries(fixture)).toEqual(sectionEntries(lf));
  expect(versionSections(fixture)).toEqual(versionSections(lf));
  expect(malformedHeadings(fixture)).toEqual(malformedHeadings(lf));
  expect(sectionEntries(fixture).flatMap((s) => s.entries)).toEqual(["Second version entry.", "First version entry."]);
});
