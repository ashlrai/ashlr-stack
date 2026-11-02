import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const root = join(import.meta.dir, "../../..");

type Nested = { version: string; parent: string; children: string[] };

/** First line of an item's own text, without its nested list. */
function ownText(item: Tokens.ListItem): string {
  return item.text.split("\n")[0].trim();
}

/**
 * Every list item that has a nested list, keyed by the `##` version heading
 * it sits under. Fenced code never counts; `#` headings and non-version `##`
 * headings reset the version to "".
 */
function nestedLists(markdown: string): Nested[] {
  const found: Nested[] = [];
  let version = "";
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      version = token.depth === 2 && /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/.test(token.text) ? token.text : "";
    }
    if (token.type !== "list") continue;
    for (const item of token.items) {
      const sub = item.tokens.find((t): t is Tokens.List => t.type === "list");
      if (sub) found.push({ version, parent: ownText(item), children: sub.items.map(ownText) });
    }
  }
  return found;
}

const fixture = [
  "# Changelog",
  "",
  "## 0.2.0 (2026-02-01)",
  "",
  "### Added",
  "",
  "- Parent entry:",
  "  - child one",
  "  - child two",
  "- Flat entry",
  "",
  "## 0.1.0 (2026-01-01)",
  "",
  "- Older parent",
  "  - older child",
  "",
  "```md",
  "- fenced parent",
  "  - fenced child",
  "```",
  "",
].join("\n");

test("nested list parsing keeps children under their own version", () => {
  expect(nestedLists(fixture)).toEqual([
    { version: "0.2.0 (2026-02-01)", parent: "Parent entry:", children: ["child one", "child two"] },
    { version: "0.1.0 (2026-01-01)", parent: "Older parent", children: ["older child"] },
  ]);
});

test("nested items outside a version section get no version", () => {
  expect(nestedLists("## Unreleased\n\n- a\n  - b\n")).toEqual([{ version: "", parent: "a", children: ["b"] }]);
});

/** Item text in document order, parents before their nested items, depth-first. */
function flattenItems(list: Tokens.List): string[] {
  return list.items.flatMap((item) => {
    const sub = item.tokens.find((t): t is Tokens.List => t.type === "list");
    return [ownText(item), ...(sub ? flattenItems(sub) : [])];
  });
}

/** Flattened item text of every list under each version heading. */
function entriesByVersion(markdown: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let version = "";
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      version = token.depth === 2 && /^\d+\.\d+\.\d+(?:\s|$)/.test(token.text) ? token.text : "";
    } else if (token.type === "list" && version) {
      (out[version] ??= []).push(...flattenItems(token));
    }
  }
  return out;
}

test("fixture entry retains parent and nested list text in order", () => {
  const md = readFileSync(join(import.meta.dir, "__fixtures__/changelog-nested-lists.md"), "utf8");
  expect(entriesByVersion(md)).toEqual({
    "0.2.0 (2026-02-01)": [
      "Parent alpha:",
      "child alpha one",
      "child alpha two",
      "grandchild alpha",
      "Flat entry",
      "Parent beta",
      "ordered beta one",
      "ordered beta two",
    ],
    "0.1.0 (2026-01-01)": ["Older parent", "older child"],
  });
  expect(nestedLists(md).map((n) => n.parent)).toEqual(["Parent alpha:", "Parent beta", "Older parent"]);
});

// The root CHANGELOG.md is the source of truth; the site copy is synced from it.
const sources = [
  ["root CHANGELOG.md", "CHANGELOG.md"],
  ["site changelog", "packages/site/src/data/CHANGELOG.md"],
] as const;

for (const [label, path] of sources) {
  const published = readFileSync(join(root, path), "utf8");

  test(`${label} retains its nested lists under the right versions`, () => {
    const nested = nestedLists(published);

    const demo = nested.filter((n) => n.version === "0.2.1 (2026-10-16)");
    expect(demo).toHaveLength(1);
    expect(demo[0].parent).toStartWith("Clickable in-hero animation");
    expect(demo[0].children).toHaveLength(2);
    expect(demo[0].children[0]).toContain("GenerateStackDemo.tsx");

    const docs = nested.filter((n) => n.version === "0.1.0 — 2026-04-19 (superseded by 0.1.1)");
    expect(docs).toHaveLength(1);
    expect(docs[0].children).toHaveLength(4);
    expect(docs[0].children[0]).toContain("packages/cli/README.md");
    expect(docs[0].children[3]).toContain("LICENSE");

    expect(nested).toHaveLength(2);
  });

  test(`every indented bullet in the ${label} is parsed as a nested item`, () => {
    let inFence = false;
    let indented = 0;
    for (const line of published.split("\n")) {
      if (/^\s*```/.test(line)) inFence = !inFence;
      else if (!inFence && /^ +[-*] /.test(line)) indented++;
    }
    const parsed = nestedLists(published).reduce((sum, n) => sum + n.children.length, 0);
    expect(parsed).toBe(indented);
  });
}
