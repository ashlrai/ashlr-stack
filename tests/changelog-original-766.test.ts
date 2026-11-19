import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseChangelog } from "./changelog-parse.test";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("site multi-version fixture keeps each entry under its own version heading", () => {
  // Fixture lines are copied verbatim from the site CHANGELOG.md, across three heading styles.
  const fixture = parseChangelog(read("./__fixtures__/changelog-original-766.md"));
  const site = parseChangelog(read("../packages/site/src/data/CHANGELOG.md"));
  expect(fixture.map((v) => [v.version, v.date])).toEqual([
    [null, null],
    ["0.3.0", "2026-10-31"],
    ["0.2.0", "2026-04-23"],
  ]);
  for (const v of fixture) {
    expect(v.entries).toHaveLength(2);
    const source = site.find((s) => s.version === v.version);
    expect(source).toBeDefined();
    // Same entries, same relative order, and none leaked in from a neighbouring version.
    // Position-independent on purpose: new entries land anywhere in the live Unreleased section.
    const indexes = v.entries.map((e) => source!.entries.indexOf(e));
    expect(indexes.every((i) => i >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    for (const other of fixture.filter((o) => o !== v)) {
      for (const e of v.entries) expect(other.entries).not.toContain(e);
    }
  }
});
