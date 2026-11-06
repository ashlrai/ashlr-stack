import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-hyphenated.md"), "utf8");

/** Item texts of the first list under the `##` section whose heading text is exactly `heading`. */
function itemsFor(heading: string): string[] {
  const tokens = marked.lexer(fixture);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  const list = tokens.slice(start + 1, end === -1 ? undefined : end).find((t) => t.type === "list");
  return ((list as Tokens.List | undefined)?.items ?? []).map((i) => i.text);
}

test("hyphenated words stay intact in entry text under their version", () => {
  expect(itemsFor("0.7.0 (2026-11-02)")).toEqual([
    "Fixed the well-known, long-standing, state-of-the-art re-run bug in non-interactive mode.",
    "Kept self-hosted, pre-1.0, e-mail-style and cross-platform names like `--dry-run` intact.",
    "Trailing hyphen- and leading -dash words stay as written; en-dash range 1-10 too.",
  ]);
});

test("hyphenated entries do not leak into the next version", () => {
  expect(itemsFor("0.6.0 (2026-11-01)")).toEqual(["Added built-in, opt-in, one-time setup"]);
});

test("hyphens are not turned into list bullets or dashes when rendered", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("well-known, long-standing, state-of-the-art re-run");
  expect(html).toContain("<code>--dry-run</code>");
  expect(html.match(/<li>/g)?.length).toBe(4);
});
