import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const siteChangelog = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** All list items from the Markdown, with their raw and parsed text. */
function allItems(markdown: string): Tokens.ListItem[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items);
}

test("site changelog entry with a colon retains the colon and text on both sides", () => {
  const items = allItems(siteChangelog);
  const fleetDiagnostics = items.find((item) => item.text.startsWith("Fleet diagnostics:"));
  expect(fleetDiagnostics).toBeDefined();

  const text = fleetDiagnostics!.text;
  // The colon must be present.
  expect(text).toContain(":");

  // Text before the colon.
  const colonIndex = text.indexOf(":");
  const before = text.slice(0, colonIndex);
  expect(before).toBe("Fleet diagnostics");

  // Text after the colon.
  const after = text.slice(colonIndex + 1);
  expect(after).toStartWith(" lanes, supply, latency");
  expect(after).toContain("stack fleet");
});

test("site changelog entry with a mid-sentence colon preserves surrounding text", () => {
  const items = allItems(siteChangelog);
  const fleetJsonl = items.find((item) => item.text.startsWith("Fleet JSONL reads"));
  expect(fleetJsonl).toBeDefined();

  const text = fleetJsonl!.text;
  expect(text).toContain(":");

  const colonIndex = text.indexOf(":");
  const before = text.slice(0, colonIndex);
  expect(before).toEndWith("while reading");
  expect(before).not.toBe("");

  const after = text.slice(colonIndex + 1);
  expect(after).toStartWith(" a non-tail read");
  expect(after).not.toBe("");
});

test("colons in the site changelog do not produce heading or definition tokens", () => {
  const tokens = marked.lexer(siteChangelog);
  const definitions = tokens.filter((t) => t.type === "def");
  expect(definitions).toEqual([]);

  // Every "Fleet diagnostics:" style entry stays as a list item, not a heading.
  const items = allItems(siteChangelog);
  const withColon = items.filter((item) => item.text.includes(":"));
  expect(withColon.length).toBeGreaterThan(0);
});

test("rendered site changelog HTML preserves colons in list items", async () => {
  const html = await marked.parse(siteChangelog);
  expect(html).toContain("<li>Fleet diagnostics: lanes, supply, latency");
  expect(html).toContain("<li>Fleet JSONL reads");
});
