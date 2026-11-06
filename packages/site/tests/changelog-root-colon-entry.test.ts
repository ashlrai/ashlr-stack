import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

// Reads the root CHANGELOG.md directly (no fixture) and checks the "Fleet diagnostics:" entry
// from release 0.3.0 / Added keeps its colon and the text on both sides.
const root = readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8");

const BEFORE = "Fleet diagnostics";
const AFTER = "lanes, supply, latency, lag, waste, reds, silent jobs, collisions, delivery lag, stuck jobs, SLOs, activity, stream, graph and bets";

function colonEntries(): Tokens.ListItem[] {
  return marked
    .lexer(root)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items)
    .filter((item) => item.text.startsWith(`${BEFORE}:`));
}

test("root changelog entry keeps the colon with text on both sides", () => {
  const found = colonEntries();
  expect(found).toHaveLength(1);
  const text = found[0].text;
  expect(text.indexOf(":")).toBe(BEFORE.length);
  expect(text.slice(0, BEFORE.length)).toBe(BEFORE);
  expect(text.slice(BEFORE.length + 1).trimStart().startsWith(AFTER)).toBe(true);
});

test("the colon entry sits under 0.3.0 / Added and is not parsed as a heading", () => {
  let release = "";
  let section = "";
  let where: string | null = null;
  for (const token of marked.lexer(root)) {
    if (token.type === "heading") {
      if (token.depth === 2) release = token.text;
      if (token.depth === 3) section = token.text;
    }
    if (token.type === "list" && token.items.some((i: Tokens.ListItem) => i.text.startsWith(`${BEFORE}:`))) {
      where = `${release} / ${section}`;
    }
  }
  expect(where).toBe("0.3.0 (2026-10-31) / Added");
  expect(marked.lexer(root).some((t) => t.type === "heading" && t.text.includes(`${BEFORE}:`))).toBe(false);
});
