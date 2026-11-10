import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseChangelog } from "./changelog-parse.test";
import { inlineLinks, sectionEntries, versionBodies, versionSections } from "./changelog-parser-utils";

const fixture = readFileSync(new URL("./__fixtures__/changelog-no-final-newline.md", import.meta.url), "utf8");

test("fixture really ends without a newline", () => {
  expect(fixture.endsWith("\n")).toBe(false);
  expect(fixture.endsWith("no newline.")).toBe(true);
});

test("final version and its last entry are retained", () => {
  const bodies = versionBodies(fixture);
  expect([...bodies.keys()]).toEqual(["## 0.2.0 (2026-05-01)", "## 0.1.0 (2026-04-19)"]);
  const last = bodies.get("## 0.1.0 (2026-04-19)") ?? "";
  expect(last).toContain("- First version entry, final line has no newline.");
  expect(last.trimEnd().endsWith("no newline.")).toBe(true);
});

test("earlier version is not polluted by the final one", () => {
  expect(versionBodies(fixture).get("## 0.2.0 (2026-05-01)")).toBe("\n### Added\n\n- Second version entry.\n\n");
});

test("every level-2 heading in the unterminated fixture is a release heading", () => {
  const headings = fixture.split("\n").filter((l) => /^##(?!#)/.test(l));
  expect(headings).toEqual(["## Unreleased", "## 0.2.0 (2026-05-01)", "## 0.1.0 (2026-04-19)"]);
});

test("final entry keeps its full text, link and unicode when the file has no final newline", () => {
  const md = readFileSync(new URL("./__fixtures__/changelog-no-final-newline-links.md", import.meta.url), "utf8");
  expect(md.endsWith("\n")).toBe(false);
  const final = "Final entry with a [provider guide](docs/adding-a-provider.md) link, café — and a trailing `code`";
  expect(sectionEntries(md).at(-1)?.entries).toEqual(["First entry.", final]);
  expect(versionSections(md).at(-1)?.body.trimEnd().endsWith("`code`")).toBe(true);
  expect(inlineLinks(versionBodies(md).get("## 0.1.0 (2026-04-19)") ?? "")).toEqual([
    { label: "provider guide", destination: "docs/adding-a-provider.md" },
  ]);
});

/** Parsed view of a changelog; bodies are trimmed because the trailing newline only adds a blank line. */
function parsed(md: string) {
  return {
    entries: sectionEntries(md),
    sections: versionSections(md).map((s) => ({ heading: s.heading, body: s.body.trimEnd() })),
    bodies: [...versionBodies(md)].map(([heading, body]) => [heading, body.trimEnd()]),
    links: inlineLinks(md),
  };
}

const withoutNewline = (md: string) => md.replace(/\n+$/, "");
const withNewline = (md: string) => `${withoutNewline(md)}\n`;

test.each([
  ["no-final-newline fixture", fixture],
  ["links fixture", readFileSync(new URL("./__fixtures__/changelog-no-final-newline-links.md", import.meta.url), "utf8")],
  ["repo CHANGELOG.md", readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8")],
])("%s: versions and entries parse identically with and without a final newline", (_name, md) => {
  const bare = withoutNewline(md);
  const terminated = withNewline(md);
  expect(bare.endsWith("\n")).toBe(false);
  expect(terminated.endsWith("\n")).toBe(true);
  expect(parsed(terminated)).toEqual(parsed(bare));
  expect(sectionEntries(bare).length).toBeGreaterThan(0);
});

test("a CRLF final newline parses the same as no final newline", () => {
  expect(parsed(`${withoutNewline(fixture)}\r\n`)).toEqual(parsed(withoutNewline(fixture)));
});

test("the same single entry parses to the same text with and without a final newline", () => {
  const entry = "Same entry, with a [link](docs/x.md) and `code`.";
  const doc = `## 0.1.0 (2026-04-19)\n\n### Added\n\n- ${entry}`;
  const [bare, terminated] = [doc, `${doc}\n`].map((md) => sectionEntries(md).at(-1)?.entries);
  expect(bare).toEqual([entry]);
  expect(terminated).toEqual(bare);
});

test("two entries are retained in order without a final newline", () => {
  const doc = "## 0.1.0 (2026-04-19)\n\n### Added\n\n- First entry.\n- Second entry.";
  expect(doc.endsWith("\n")).toBe(false);
  expect(sectionEntries(doc).at(-1)?.entries).toEqual(["First entry.", "Second entry."]);
});

test("the final entry parses identically with and without a final newline", () => {
  const md = [
    "## 1.1.0 (2026-11-09)",
    "### Added",
    "- Earlier release.",
    "## 1.0.0 (2026-11-01)",
    "### Fixed",
    "- First fix.",
    "- Final fix with [details](docs/fix.md), café, and `code`.",
  ].join("\n");

  expect(md.endsWith("\n")).toBe(false);
  const expected = [
    { version: "1.1.0", date: "2026-11-09", entries: ["Earlier release."] },
    {
      version: "1.0.0",
      date: "2026-11-01",
      entries: ["First fix.", "Final fix with [details](docs/fix.md), café, and `code`."],
    },
  ];
  expect(parseChangelog(md)).toEqual(expected);
  expect(parseChangelog(`${md}\n`)).toEqual(expected);
});
