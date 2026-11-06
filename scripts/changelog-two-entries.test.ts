import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs module without type declarations
import { parseLatestRelease, parseReleaseEntries } from "./freshness/lib.mjs";

const read = (name: string) => readFileSync(new URL(`./__fixtures__/changelog/${name}.md`, import.meta.url), "utf8");
const entriesOf = (name: string): string[] => parseReleaseEntries(parseLatestRelease(read(name)).entry);

test("two entries under one version are returned separately and in order", () => {
  expect(entriesOf("two-entries-one-version")).toEqual([
    "- Zulu entry comes first and must stay first.",
    "- Alpha entry comes second, with `code` and a [link](https://example.com/alpha).",
  ]);
});

test("CRLF endings give the same entries", () => {
  const crlf = read("two-entries-one-version").replace(/\n/g, "\r\n");
  expect(parseReleaseEntries(parseLatestRelease(crlf).entry)).toEqual(entriesOf("two-entries-one-version"));
});

test("subsections, blank lines, continuations and duplicates", () => {
  expect(entriesOf("multi-entry-order")).toHaveLength(5);
  expect(entriesOf("multi-entry-order")[2]).toBe(
    "- Mike entry wraps onto a second line\n  and keeps its indented continuation.",
  );
  expect(entriesOf("blank-line-between-entries").map((e) => e.split(" ")[1])).toEqual(["First", "Second", "Third", "Fourth"]);
  expect(entriesOf("blank-line-between-entries")[3]).toContain("Fourth");
});

test("a release with no bullets has no entries", () => {
  expect(parseReleaseEntries("### Added\n\nplain text")).toEqual([]);
});
