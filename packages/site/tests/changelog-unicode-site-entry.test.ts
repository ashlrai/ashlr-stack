import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const dir = import.meta.dir;
const fixture = readFileSync(join(dir, "__fixtures__/changelog-unicode-site-entry.md"), "utf8");
const published = readFileSync(join(dir, "../src/data/CHANGELOG.md"), "utf8");

// Same H1 strip the /docs/changelog page applies before rendering.
const stripH1 = (markdown: string) => markdown.replace(/^#\s+Changelog\s*\n+/, "");

/** Plain text of each list entry under each `##` heading, in order. */
function entriesByHeading(markdown: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let heading: string | null = null;
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth === 2) out[(heading = t.text)] = [];
    else if (heading && t.type === "list") for (const item of t.items) out[heading].push(item.text);
  }
  return out;
}

const UNICODE_ENTRY =
  "Unicode entry: café ☕, 日本語, שלום, ❤️, 👩‍💻 and a line separator stay one entry.";

test("the Unicode entry parses as one entry under Unreleased, text unchanged", () => {
  const parsed = entriesByHeading(fixture);
  expect(Object.keys(parsed)).toEqual(["Unreleased", "0.3.0 (2026-10-31)"]);
  expect(parsed.Unreleased).toEqual([UNICODE_ENTRY, "Plain ASCII entry."]);
  expect(parsed["0.3.0 (2026-10-31)"]).toEqual(["Older entry with Ω and µ."]);
});

test("the page's H1 strip and render keep the Unicode entry intact", async () => {
  const body = stripH1(fixture);
  expect(body.startsWith("## Unreleased")).toBe(true);
  const html = await marked.parse(body);
  for (const text of ["café ☕", "日本語", "שלום", "❤️", "👩‍💻", " separator"]) expect(html).toContain(text);
  expect(html).not.toContain("�");
});

test("the published changelog starts without a BOM so the H1 strip still matches", () => {
  expect(published.charCodeAt(0)).not.toBe(0xfeff);
  expect(stripH1(published).startsWith("## ")).toBe(true);
});
