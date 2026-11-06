import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code-literal.md"), "utf8");

/** Top-level list items under the `##` heading with this exact text. */
function itemsFor(version: string): Tokens.ListItem[] {
  const tokens = marked.lexer(fixture);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens.slice(start + 1, end === -1 ? undefined : end).flatMap((t) => (t.type === "list" ? t.items : []));
}

/** Code span text in one entry, depth-first, including spans inside strong/link tokens. */
function spans(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    if (t.type === "codespan") return [t.text];
    const children = (t as { tokens?: Token[] }).tokens;
    return children ? spans(children) : [];
  });
}

const entries = itemsFor("0.5.0 (2026-07-01)");

test("each entry keeps the exact text of its code spans", () => {
  expect(entries).toHaveLength(5);
  expect(entries.map((e) => spans(e.tokens))).toEqual([
    ["stack apply <recipe-id>", "phantom add <NAME>"],
    ["**not bold**", "[not](a-link)", "snake_case_name", "*glob*"],
    ["a && b | c", "&amp;"],
    ["stack doctor"],
    ["`tick`", " two "],
  ]);
});

test("a span inside bold or link text stays a span, not plain text", () => {
  const strong = entries[0].tokens[0].type === "text" ? (entries[0].tokens[0] as Tokens.Text).tokens?.[0] : undefined;
  expect(strong?.type).toBe("strong");
  expect((strong as Tokens.Strong).tokens.map((t) => t.type)).toEqual(["codespan"]);

  const link = (entries[3].tokens[0] as Tokens.Text).tokens?.find((t) => t.type === "link") as Tokens.Link;
  expect(link.href).toBe("https://stack.ashlr.ai/docs");
  expect(link.tokens.map((t) => t.type)).toEqual(["text", "codespan"]);
});

test("span delimiters survive in the entry's raw source", () => {
  expect(entries[0].raw).toContain("**`stack apply <recipe-id>`**");
  expect(entries[1].raw).toContain("`**not bold**`");
  expect(entries[4].raw).toContain("`` `tick` ``");
});

test("rendered HTML escapes span text and adds no markup inside it", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("<strong><code>stack apply &lt;recipe-id&gt;</code></strong>");
  expect(html).toContain("<code>**not bold**</code>");
  expect(html).toContain("<code>[not](a-link)</code>");
  expect(html).toContain("<code>snake_case_name</code>");
  expect(html).toContain("<code>a &amp;&amp; b | c</code>");
  expect(html).toContain("<code>&amp;amp;</code>");
  expect(html).toContain('<a href="https://stack.ashlr.ai/docs">link to <code>stack doctor</code></a>');
  expect(html).not.toContain("<em>glob</em>");
  expect(html).not.toContain("<strong>not bold</strong>");
});

test("a following version without code has no spans", () => {
  const [plain] = itemsFor("0.4.0 (2026-06-01)");
  expect(spans(plain.tokens)).toEqual([]);
  expect(plain.raw).not.toContain("`");
});
