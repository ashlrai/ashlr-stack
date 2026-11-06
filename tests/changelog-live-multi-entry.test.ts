import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries } from "./changelog-parser-utils";

const source = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const multi = sectionEntries(source).filter((g) => g.entries.length > 1);

test("CHANGELOG.md has sections with several entries to check", () => {
  expect(multi.length).toBeGreaterThan(0);
});

test("every multi-entry section of CHANGELOG.md keeps its entries in source order", () => {
  // Independent oracle: the raw top-level bullet lines under each `## ` / `### ` heading pair, in file order.
  const expected: { version: string; section: string; entries: string[] }[] = [];
  let version = "";
  let current: (typeof expected)[number] | null = null;
  let fenced = false;
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (/^## /.test(line)) {
      version = line;
      current = null;
    } else if (/^### /.test(line)) {
      current = { version, section: line.slice(4), entries: [] };
      expected.push(current);
    } else if (line.startsWith("- ") && current) current.entries.push(line.slice(2));
  }
  expect(multi).toEqual(expected.filter((g) => g.entries.length > 1));
});

test("entries of each multi-entry section appear in CHANGELOG.md in the order parsed, without duplication or loss", () => {
  for (const { version, section, entries } of multi) {
    const body = source.slice(source.indexOf(`${version}\n`));
    let from = body.indexOf(`### ${section}\n`);
    expect(from).toBeGreaterThanOrEqual(0);
    for (const entry of entries) {
      const at = body.indexOf(`- ${entry}\n`, from);
      expect(at).toBeGreaterThanOrEqual(from);
      from = at + 1;
    }
  }
});

test("Unreleased Fixed entries, which are three in a row, come back in file order", () => {
  const fixed = sectionEntries(source).find((g) => g.version === "## Unreleased" && g.section === "Fixed");
  expect(fixed?.entries.length).toBeGreaterThanOrEqual(2);
  const lines = source.split("\n");
  const positions = fixed!.entries.map((e) => lines.indexOf(`- ${e}`));
  expect(positions.every((p) => p >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});
