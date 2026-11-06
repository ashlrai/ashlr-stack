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

// Built from an array (not a checked-in file) so git autocrlf/eol settings can't normalize the line endings away.
const lines = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "- Not released yet.",
  "",
  "## 0.2.0 (2026-02-02)",
  "",
  "### Added",
  "",
  "- First item.",
  "- Second item",
  "  with a continuation.",
  "",
  "```sh",
  "stack add",
  "",
  "stack apply",
  "```",
  "",
  "## [0.1.0] - 2026-01-01",
  "",
  "- Only item.",
  "",
];
const crlf = lines.join("\r\n");
const lf = lines.join("\n");

test("fixture really uses CRLF", () => {
  expect(crlf.split("\r\n").length).toBe(lines.length);
  expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
});

test("version headings parse identically under CRLF and LF", () => {
  const headings = parseVersions(crlf).map((v) => v.heading);
  expect(headings).toEqual(["0.2.0 (2026-02-02)", "[0.1.0] - 2026-01-01"]);
  expect(headings).toEqual(parseVersions(lf).map((v) => v.heading));
  for (const h of headings) expect(h).not.toContain("\r");
});

test("version bodies parse under CRLF without stray carriage returns", () => {
  const [newer, older] = parseVersions(crlf);
  expect(newer.raw).not.toContain("\r");
  expect(newer.raw).toContain("- First item.\n- Second item\n  with a continuation.");
  expect(newer.raw).not.toContain("Not released yet");
  const code = newer.body.find((t) => t.type === "code") as { text: string } | undefined;
  expect(code?.text).toBe("stack add\n\nstack apply");
  expect(older.raw.trim()).toBe("- Only item.");
  expect(parseVersions(crlf).map((v) => v.raw)).toEqual(parseVersions(lf).map((v) => v.raw));
});

test("the changelog page strips the H1 and renders the same HTML under CRLF", async () => {
  // Same H1 strip as src/pages/docs/changelog.astro.
  const strip = (s: string) => s.replace(/^#\s+Changelog\s*\n+/, "");
  expect(strip(crlf).startsWith("## Unreleased")).toBe(true);
  expect(await marked.parse(strip(crlf))).toBe(await marked.parse(strip(lf)));
});

test("site-facts release heading regex matches a CRLF changelog", () => {
  // Same pattern as latestChangelogRelease() in scripts/gen-site-facts.ts.
  const m = crlf.match(/^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)/m);
  expect(m?.[1]).toBe("0.2.0");
  expect(m?.[2]).toBe("2026-02-02");
});

test("the published CHANGELOG.md parses the same when converted to CRLF", async () => {
  const real = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
  const real_crlf = real.replace(/\n/g, "\r\n");
  expect(real_crlf).toContain("\r\n");

  const fromLf = parseVersions(real);
  const fromCrlf = parseVersions(real_crlf);
  expect(fromLf.length).toBeGreaterThan(0);
  expect(fromCrlf.map((v) => v.heading)).toEqual(fromLf.map((v) => v.heading));
  expect(fromCrlf.map((v) => v.raw)).toEqual(fromLf.map((v) => v.raw));
  expect(await marked.parse(real_crlf)).toBe(await marked.parse(real));
  expect(real_crlf.match(/^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)/m)?.slice(1)).toEqual(
    real.match(/^## (\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)/m)?.slice(1),
  );
});
