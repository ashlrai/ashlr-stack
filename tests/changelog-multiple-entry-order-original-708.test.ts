import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseChangelog } from "./changelog-parse.test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("multiple-entry fixture keeps entries in source order, including duplicates", () => {
  // Source order is deliberately not alphabetical, numeric or de-duplicated.
  const parsed = parseChangelog(read("./__fixtures__/changelog-multiple-entry-order.md"));
  expect(parsed).toEqual([
    {
      version: "0.8.0",
      date: "2026-11-03",
      entries: [
        "zebra: entry one, last alphabetically.",
        "10 items now load; sorts before 2 as text.",
        "2 flags renamed.",
        "Apple entry, capitalised.",
        "zebra: entry one, last alphabetically.",
        "apple entry, lower case.",
      ],
    },
    { version: "0.7.0", date: "2026-11-02", entries: ["Gamma.", "Alpha.", "Beta."] },
  ]);
  // Guard against a sorting parser: output must differ from every sorted form.
  const entries = parsed[0].entries;
  expect(entries).not.toEqual([...entries].sort());
  expect(entries).not.toEqual([...entries].sort().reverse());
});
