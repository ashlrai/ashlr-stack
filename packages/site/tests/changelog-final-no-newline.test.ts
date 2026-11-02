import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order; `raw` is the body's exact source text. */
function parseVersions(markdown: string): { heading: string; body: Token[]; raw: string }[] {
  const versions: { heading: string; body: Token[]; raw: string }[] = [];
  let current: { heading: string; body: Token[]; raw: string } | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 && VERSION.test(token.text) ? { heading: token.text, body: [], raw: "" } : null;
      if (current) versions.push(current);
    } else if (current) {
      current.body.push(token);
      current.raw += token.raw;
    }
  }
  return versions;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-final-no-newline.md"), "utf8");

test("fixture really ends without a trailing newline", () => {
  expect(fixture.endsWith("\n")).toBe(false);
  expect(fixture.endsWith("no trailing newline.")).toBe(true);
});

test("final version and its full body are retained without a trailing newline", () => {
  const versions = parseVersions(fixture);
  expect(versions.map((v) => v.heading)).toEqual(["0.2.0 (2026-02-01)", "0.1.0 (2026-01-01)"]);

  const last = versions[versions.length - 1];
  expect(last.body.some((t) => t.type === "heading" && t.text === "Fixed")).toBe(true);
  const list = last.body.find((t) => t.type === "list") as { items: { text: string }[] } | undefined;
  expect(list?.items.map((i) => i.text)).toEqual(["Last entry item one.", "Last entry item two, no trailing newline."]);
  expect(last.raw.endsWith("- Last entry item two, no trailing newline.")).toBe(true);
});

test("the earlier version keeps its own body when the file lacks a final newline", () => {
  const [newer] = parseVersions(fixture);
  expect(newer.raw).toContain("Closing paragraph.");
  expect(newer.raw).not.toContain("Last entry");
});

test("adding the final newline does not change any version's content", () => {
  const withNewline = parseVersions(`${fixture}\n`);
  const without = parseVersions(fixture);
  expect(withNewline.map((v) => v.heading)).toEqual(without.map((v) => v.heading));
  expect(withNewline.map((v) => v.raw.trimEnd())).toEqual(without.map((v) => v.raw.trimEnd()));
});
