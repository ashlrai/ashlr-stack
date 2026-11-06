import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const dir = join(import.meta.dir, "__fixtures__");
const lf = readFileSync(join(dir, "changelog-multiple-sections.md"), "utf8");
// The CRLF fixture is the LF fixture with Windows line endings (pinned by .gitattributes).
const crlf = readFileSync(join(dir, "changelog-multiple-sections-crlf.md"), "utf8");

/** Release (`##`) -> section (`###`) -> entry texts. Empty sections still appear with `[]`. */
function sections(markdown: string): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  let release = "";
  let section = "";
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth === 2) {
      release = token.text;
      section = "";
      out[release] = {};
    } else if (token.type === "heading" && token.depth === 3) {
      section = token.text;
      out[release][section] = [];
    } else if (token.type === "list" && section) {
      out[release][section].push(...token.items.map((item) => item.text));
    }
  }
  return out;
}

test("fixture really has CRLF endings on every line and differs from LF only by them", () => {
  expect(crlf.split("\n").length).toBe(crlf.split("\r\n").length);
  expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
  expect(crlf.replace(/\r\n/g, "\n")).toBe(lf);
});

test("sections and entries match the LF fixture and carry no \\r", () => {
  const parsed = sections(crlf);
  expect(parsed).toEqual(sections(lf));
  expect(Object.keys(parsed)).toEqual(["Unreleased", "1.2.0 (2026-05-01)", "1.1.0 (2026-04-01)"]);
  expect(parsed["1.2.0 (2026-05-01)"].Changed).toEqual(["Changed in 1.2.0 (first)", "Changed in 1.2.0 (second)"]);
  expect(parsed["1.2.0 (2026-05-01)"].Deprecated).toEqual([]);
  expect(JSON.stringify(parsed)).not.toContain("\\r");
});

test("the CRLF fixture renders the same HTML as the LF fixture", async () => {
  expect(await marked.parse(crlf)).toBe(await marked.parse(lf));
});
