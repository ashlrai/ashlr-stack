import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const VERSION = /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/;
const dir = join(import.meta.dir, "__fixtures__");

// The CRLF fixture is the LF fixture with Windows line endings (pinned by .gitattributes).
const crlf = readFileSync(join(dir, "changelog-three-versions-crlf.md"), "utf8");
const lf = readFileSync(join(dir, "changelog-three-versions.md"), "utf8");

/** Each version heading with the plain text of its list entries. */
function parse(markdown: string): { heading: string; entries: string[] }[] {
  const out: { heading: string; entries: string[] }[] = [];
  let current: { heading: string; entries: string[] } | null = null;
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth === 2) {
      current = VERSION.test(t.text) ? { heading: t.text, entries: [] } : null;
      if (current) out.push(current);
    } else if (current && t.type === "list") {
      for (const item of t.items) current.entries.push(item.text);
    }
  }
  return out;
}

test("checked-in fixture really has CRLF endings on every line", () => {
  expect(crlf.split("\n").length).toBe(crlf.split("\r\n").length);
  expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
  expect(crlf.replace(/\r\n/g, "\n")).toBe(lf);
});

test("version headings and entries match the LF fixture and carry no \\r", () => {
  const parsed = parse(crlf);
  expect(parsed).toEqual(parse(lf));
  expect(parsed.map((v) => v.heading)).toEqual(["0.3.0 (2026-05-01)", "[0.2.0] — 2026-04-23", "0.1.0 (2026-04-19)"]);
  expect(parsed.map((v) => v.entries)).toEqual([["Third version entry."], ["Second version entry."], ["First version entry."]]);
  expect(JSON.stringify(parsed)).not.toContain("\\r");
});

test("the real CHANGELOG.md parses the same when converted to CRLF", () => {
  const real = readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
  const asCrlf = real.replace(/\n/g, "\r\n");
  const versions = parse(real);
  expect(versions.length).toBeGreaterThan(0);
  expect(parse(asCrlf)).toEqual(versions);
});

test("the published site CHANGELOG.md has the same version headings and entries when converted to CRLF", () => {
  const real = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
  const versions = parse(real);
  expect(versions.length).toBeGreaterThan(0);
  expect(versions.some((v) => v.entries.length > 0)).toBe(true);
  const fromCrlf = parse(real.replace(/\n/g, "\r\n"));
  expect(fromCrlf).toEqual(versions);
  expect(JSON.stringify(fromCrlf)).not.toContain("\\r");
});
