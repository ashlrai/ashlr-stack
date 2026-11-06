import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

// Two entries excerpted verbatim from packages/site/src/data/CHANGELOG.md (0.1.0): a bold lead-in
// that holds inline code, then an em dash and plain prose.
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-bold-published-entry.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

const BOLD = "**`stack env show` / `stack env diff`**";
const REST =
  " — effective env-var surface. Shows which declared slots are present in Phantom (masked), surfaces vault orphans, or prints just the missing set.";

function entries(markdown: string): Tokens.ListItem[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items);
}

test("the parsed entry keeps its bold Markdown and the text around it", () => {
  const found = entries(fixture);
  expect(found).toHaveLength(2);
  expect(found[0].text).toBe(`${BOLD}${REST}`);
  expect(found[1].text).toBe("**`stack upgrade`** — checks the npm registry for a newer `@ashlr/stack` release.");
});

test("the bold span is a strong token wrapping the inline code, not the prose", () => {
  const lead = entries(fixture)[0].tokens[0] as Tokens.Text;
  const strong = lead.tokens?.find((t): t is Tokens.Strong => t.type === "strong");
  expect(strong?.raw).toBe(BOLD);
  expect(strong?.text).toBe("`stack env show` / `stack env diff`");
});

test("the rendered entry bolds only the lead-in", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("<strong><code>stack env show</code> / <code>stack env diff</code></strong> — effective env-var surface.");
  expect(html.match(/<strong>/g)).toHaveLength(2);
});

test("the fixture entries are still present verbatim in the published changelog", () => {
  const raws = entries(published).map((e) => e.raw.trim());
  for (const entry of entries(fixture)) expect(raws).toContain(entry.raw.trim());
});
