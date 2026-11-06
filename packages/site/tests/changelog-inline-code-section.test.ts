import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-inline-code-section.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

type Entry = { version: string; section: string; raw: string; code: string[] };

function spans(tokens: Token[]): string[] {
  return tokens.flatMap((t) => {
    if (t.type === "codespan") return [t.text];
    const children = (t as { tokens?: Token[]; items?: Token[] });
    return spans([...(children.tokens ?? []), ...(children.items ?? [])]);
  });
}

/** Every top-level list entry with the `##` version and `###` section it sits under. */
function parse(markdown: string): Entry[] {
  const out: Entry[] = [];
  let version = "";
  let section = "";
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth === 2) [version, section] = [t.text, ""];
    else if (t.type === "heading" && t.depth === 3) section = t.text;
    else if (t.type === "list") {
      for (const item of (t as Tokens.List).items) {
        out.push({ version, section, raw: item.raw, code: spans(item.tokens) });
      }
    }
  }
  return out;
}

test("each entry keeps its inline code under the right version and section", () => {
  expect(parse(fixture).map((e) => [e.version, e.section, e.code])).toEqual([
    ["Unreleased", "Fixed", ["stack doctor --repos"]],
    ["0.3.0 (2026-10-31)", "Added", ["stack doctor --repos", "GH_TOKEN"]],
    ["0.3.0 (2026-10-31)", "Changed", ["stack apply", "--noWire", "STACK_MANIFEST"]],
    ["0.2.0 (2026-05-01)", "Added", ["stack doctor --repos", "stack scan"]],
  ]);
});

test("the same span in three versions never crosses a version boundary", () => {
  const hits = parse(fixture).filter((e) => e.code.includes("stack doctor --repos"));
  expect(hits.map((e) => e.version)).toEqual(["Unreleased", "0.3.0 (2026-10-31)", "0.2.0 (2026-05-01)"]);
});

test("the page's render path (H1 stripped) emits each span as <code> inside its own version block", async () => {
  const html = await marked.parse(fixture.replace(/^#\s+Changelog\s*\n+/, ""), { gfm: true, breaks: false });
  const blocks = html.split(/(?=<h2>)/);
  expect(blocks).toHaveLength(3);
  expect(blocks[1]).toContain("<h2>0.3.0 (2026-10-31)</h2>");
  expect(blocks[1]).toContain("<code>GH_TOKEN</code>");
  expect(blocks[1]).toContain("<code>STACK_MANIFEST</code>");
  expect(blocks[0]).not.toContain("GH_TOKEN");
  expect(blocks[2]).not.toContain("GH_TOKEN");
  expect(blocks[2]).toContain("<code>stack scan</code>");
});

test("published 0.3.0 Added keeps `stack doctor --repos` under 0.3.0 only", () => {
  const hit = parse(published).filter((e) => e.code.includes("stack doctor --repos"));
  expect(hit.length).toBeGreaterThan(0);
  expect(hit.every((e) => e.version.startsWith("0.3.0") && e.section === "Added")).toBe(true);
});
