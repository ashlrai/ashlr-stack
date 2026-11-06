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

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-no-trailing-newline.md"), "utf8");

test("fixture really ends without a trailing newline", () => {
  expect(fixture.endsWith("\n")).toBe(false);
});

test("final version and its full body are kept when the file has no trailing newline", () => {
  const versions = parseVersions(fixture);
  expect(versions.map((v) => v.heading)).toEqual(["0.2.0 (2026-02-01)", "0.1.0 (2026-01-01)"]);
  const last = versions[versions.length - 1];
  expect(last.raw).toBe("\n\n### Added\n\n- First item.\n- Final line with no newline");
  const list = last.body.find((t) => t.type === "list") as { items: { text: string }[] } | undefined;
  expect(list?.items.map((i) => i.text)).toEqual(["First item.", "Final line with no newline"]);
});

test("a trailing newline does not change the final version's content", () => {
  const withNl = parseVersions(`${fixture}\n`).pop();
  const without = parseVersions(fixture).pop();
  expect(withNl?.raw.trimEnd()).toBe(without?.raw);
});
