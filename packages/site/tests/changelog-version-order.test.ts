import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Version headings exactly as written; the parser must never sort them. */
function versionHeadings(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .flatMap((t) => (t.type === "heading" && t.depth === 2 && VERSION.test(t.text) ? [t.text] : []));
}

test("deliberately ascending fixture keeps both entries in source order", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-version-order.md"), "utf8");
  expect(versionHeadings(fixture)).toEqual(["0.1.0 (2026-04-19)", "0.2.0 (2026-04-23)"]);
});

test("reversing the fixture's sections reverses the parsed order (no implicit sorting)", () => {
  const swapped = "## 0.2.0\n\n- b\n\n## 0.1.0\n\n- a\n";
  expect(versionHeadings(swapped)).toEqual(["0.2.0", "0.1.0"]);
});
