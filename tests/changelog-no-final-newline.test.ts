import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
