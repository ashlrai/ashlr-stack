import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code-placeholders.md"), "utf8");

/** Code span text in one entry, depth-first. */
function spans(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    if (t.type === "codespan") return [t.text];
    const children = (t as { tokens?: Token[] }).tokens;
    return children ? spans(children) : [];
  });
}

function itemsUnder(version: string): Tokens.ListItem[] {
  const tokens = marked.lexer(fixture);
  const start = tokens.findIndex((t) => t.type === "heading" && t.depth === 2 && t.text === version);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((t, i) => i > start && t.type === "heading" && t.depth <= 2);
  return tokens.slice(start + 1, end === -1 ? undefined : end).flatMap((t) => (t.type === "list" ? t.items : []));
}

const entries = itemsUnder("0.4.0 (2026-11-01)");

test("dollar placeholders and quoted literals keep their exact content", () => {
  expect(entries).toHaveLength(3);
  expect(spans(entries[0].tokens)).toEqual(["$VERSION$", "$SHA_*$", "sed"]);
  expect(spans(entries[1].tokens)).toEqual([
    "(timed out after 2s)",
    "--json",
    'secret_count_error: "timeout"',
    '"error"',
  ]);
});

test("a double-backtick span keeps an inner backtick pair and the em dash", () => {
  expect(spans(entries[2].tokens)).toEqual([
    "(not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)",
  ]);
  expect(entries[2].raw).toContain("``(not in Phantom: OPENAI_API_KEY — store with `phantom add <NAME>`)``");
});

test("rendered HTML keeps placeholders and quotes escaped inside <code>", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("<code>$VERSION$</code>");
  expect(html).toContain("<code>$SHA_*$</code>");
  expect(html).toContain("<code>secret_count_error: &quot;timeout&quot;</code>");
  expect(html).toContain("<code>(not in Phantom: OPENAI_API_KEY — store with `phantom add &lt;NAME&gt;`)</code>");
});

test("the entry after the code-bearing version has no spans", () => {
  const [plain] = itemsUnder("0.3.0 (2026-10-01)");
  expect(spans(plain.tokens)).toEqual([]);
});
