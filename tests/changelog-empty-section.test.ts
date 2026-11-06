import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const fixture = readFileSync(new URL("./__fixtures__/changelog-empty-section.md", import.meta.url), "utf8");

type Version = { heading: string; sections: Map<string, string[]> };

/** Parse semver `##` versions, their `###` sections and `- ` entries. */
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

test("empty section stays empty and the next populated section owns its entry", () => {
  const [latest] = parse(fixture);
  expect([...(latest?.sections ?? [])]).toEqual([
    ["Added", []],
    ["Fixed", ["Populated entry for Fixed."]],
  ]);
});

test("populated entry is returned exactly once across the whole changelog", () => {
  const all = parse(fixture).flatMap((v) => [...v.sections.values()].flat());
  expect(all.filter((e) => e === "Populated entry for Fixed.")).toHaveLength(1);
  expect(all).toHaveLength(2);
});

test("empty input returns no versions without throwing", () => {
  expect(() => parse("")).not.toThrow();
  expect(parse("")).toEqual([]);
});
