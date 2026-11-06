import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-hyphenated-original-632.md"), "utf8");

/** Item texts of the first list under the `##` section whose heading text is exactly `heading`. */
function itemsFor(heading: string): string[] {
  const tokens = marked.lexer(fixture);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  const list = tokens.slice(start + 1, end === -1 ? undefined : end).find((t) => t.type === "list");
  return ((list as Tokens.List | undefined)?.items ?? []).map((i) => i.text);
}

test("hyphenated words stay whole and attached to their version", () => {
  expect(itemsFor("0.7.0 (2026-11-02)")).toEqual([
    "Added well-known, state-of-the-art, and up-to-date checks for read-only, opt-in flags",
    "Re-run the pre-commit hook; non-breaking, cross-platform, multi-word-hyphenated-term support",
    "Leading-dash-free: a - b stays spaced, and trailing-hyphen- survives, as does --long-flag and -x",
  ]);
});

test("the next version is not affected by the hyphenated entries", () => {
  expect(itemsFor("0.6.0 (2026-11-01)")).toEqual(["Plain entry with no hyphenated words"]);
});

test("rendered HTML keeps hyphens intact", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("state-of-the-art");
  expect(html).toContain("multi-word-hyphenated-term");
  expect(html).toContain("--long-flag and -x");
});
