import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseChangelog } from "./changelog-parse.test";
import { inlineLinks, malformedHeadings, sectionEntries, versionBodies, versionSections } from "./changelog-parser-utils";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("hyphenated-word fixture retains every hyphenated word in parsed entries", () => {
  expect(parseChangelog(read("./__fixtures__/changelog-original-748.md"))).toEqual([
    { version: null, date: null, entries: ["Full-stack rewrite of the onboarding flow."] },
    {
      version: "0.3.0",
      date: "2026-10-31",
      entries: [
        "Real-time collaboration with self-hosted sync.",
        "Support for cross-platform, agent-native tooling.",
        "Work around a well-known edge case in error-handling.",
      ],
    },
    {
      version: "0.2.0",
      date: "2026-04-23",
      entries: ["Opt-in, best-effort offline mode for deep-link navigation."],
    },
  ]);
  // CRLF line endings must not strip hyphens either.
  const md = read("./__fixtures__/changelog-original-748.md");
  expect(parseChangelog(md.replace(/\n/g, "\r\n"))).toEqual(parseChangelog(md));
  // Per-section view: hyphenated text stays intact in section entries too.
  expect(sectionEntries(md).map((s) => [s.section, s.entries])).toEqual([
    ["Added", ["Real-time collaboration with self-hosted sync.", "Support for cross-platform, agent-native tooling."]],
    ["Fixed", ["Work around a well-known edge case in error-handling."]],
  ]);
});
