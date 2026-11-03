import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code-wrapped.md"), "utf8");

const items = marked
  .lexer(fixture)
  .flatMap((t) => (t.type === "list" ? (t as Tokens.List).items : []));

/** Code span text in one entry, depth-first. */
function spans(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    if (t.type === "codespan") return [t.text];
    const children = (t as { tokens?: Token[] }).tokens;
    return children ? spans(children) : [];
  });
}

test("a span wrapped across a source line stays one span with its text", () => {
  expect(items).toHaveLength(3);
  // CommonMark turns the line break inside a span into a single space.
  expect(spans(items[0].tokens)).toEqual(["stack add <provider>", "--dry-run"]);
  expect(items[0].raw).toContain("`stack add\n  <provider>`");
});

test("spans in every paragraph of a multi-paragraph entry belong to that entry", () => {
  expect(spans(items[1].tokens)).toEqual(["first", "second", "`quoted`"]);
  expect(items[1].raw).toContain("`` `quoted` ``");
  expect(spans(items[2].tokens)).toEqual(["OPENAI_API_KEY"]);
});
