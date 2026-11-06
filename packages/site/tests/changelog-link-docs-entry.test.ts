import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

// The "Adding a provider" entry excerpted from packages/site/src/data/CHANGELOG.md, release 0.2.1 / Docs.
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-link-docs-entry.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

const TEXT = "docs/adding-a-provider.md";
const HREF = "docs/adding-a-provider.md";

function entries(markdown: string): Tokens.ListItem[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items);
}

function links(tokens: Token[]): Tokens.Link[] {
  return tokens.flatMap((t) => [
    ...(t.type === "link" ? [t] : []),
    ...links((t as { tokens?: Token[] }).tokens ?? []),
  ]);
}

test("the entry keeps its link text and destination", () => {
  const found = entries(fixture);
  expect(found).toHaveLength(1);
  const [link, ...rest] = links(found[0].tokens);
  expect(rest).toHaveLength(0);
  expect(link.text).toBe(TEXT);
  expect(link.href).toBe(HREF);
});

test("the link sits between the bold lead and the sentence, and the text around it survives", () => {
  const [entry] = entries(fixture);
  expect(entry.text).toStartWith(`**Adding a provider** — [${TEXT}](${HREF}) lists every file a new provider touches`);
  expect(entry.text).toEndWith("disagree (#18).");
  expect(entry.tokens[0].type).toBe("text");
});

test("the rendered entry is an anchor with the same text and destination, next to the bold lead and inline code", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain(`<strong>Adding a provider</strong> — <a href="${HREF}">${TEXT}</a> lists every file`);
  expect(html).toContain("<code>provider-parity.test.ts</code>");
});

test("the fixture entry is still present verbatim, link included, in the published changelog", () => {
  const match = entries(published).find((e) => e.raw.trim() === entries(fixture)[0].raw.trim());
  expect(match).toBeDefined();
  expect(links(match?.tokens ?? []).map((l) => [l.text, l.href])).toEqual([[TEXT, HREF]]);
});
