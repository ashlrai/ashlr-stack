import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Docs link source symbols by line, e.g. [`listSecrets`](../packages/core/src/phantom.ts#L271).
// Line numbers drift silently when the source changes, so every link whose text
// is a single backticked identifier must still land on that identifier's
// declaration, or on the first line of the doc comment directly above it.
// Links with prose text ("handler template", `stack apply`) are not checked here.

const root = resolve(import.meta.dir, "..");
const docsDir = join(root, "docs");
const LINE_LINK = /\[`([A-Za-z_$][\w$]*)`\]\(([^)\s#]+)#L(\d+)\)/g;

type Anchor = { doc: string; symbol: string; target: string; line: number };

function collectAnchors(): Anchor[] {
  const anchors: Anchor[] = [];
  for (const name of readdirSync(docsDir).filter((file) => file.endsWith(".md"))) {
    const path = join(docsDir, name);
    for (const match of readFileSync(path, "utf8").matchAll(LINE_LINK)) {
      anchors.push({
        doc: relative(root, path),
        symbol: match[1],
        target: resolve(dirname(path), match[2]),
        line: Number(match[3]),
      });
    }
  }
  return anchors;
}

function declares(line: string, symbol: string): boolean {
  return new RegExp(
    `\\b(?:function|const|let|var|class|interface|type|enum)\\s+${symbol.replace(/\$/g, "\\$")}\\b`,
  ).test(line);
}

/** True when `line` (1-based) is the declaration, or opens the doc comment right above it. */
function anchorHitsDeclaration(source: string, line: number, symbol: string): boolean {
  const lines = source.split("\n");
  const at = lines[line - 1];
  if (at === undefined) return false;
  if (declares(at, symbol)) return true;
  if (!at.trimStart().startsWith("/**")) return false;
  for (let i = line - 1; i < lines.length; i++) {
    if (lines[i].includes("*/")) return declares(lines[i + 1] ?? "", symbol);
  }
  return false;
}

describe("doc line anchors", () => {
  const anchors = collectAnchors();

  it("finds the line-anchored symbol links in docs/", () => {
    expect(anchors.length).toBeGreaterThan(0);
  });

  it("points every backticked-symbol line anchor at that symbol's declaration", () => {
    const stale = anchors
      .filter(
        (a) =>
          !existsSync(a.target) ||
          !anchorHitsDeclaration(readFileSync(a.target, "utf8"), a.line, a.symbol),
      )
      .map((a) => `${a.doc}: \`${a.symbol}\` -> ${relative(root, a.target)}#L${a.line}`);
    expect(stale).toEqual([]);
  });

  it("rejects a drifted anchor and accepts a doc-comment anchor", () => {
    const source = ["", "/**", " * Doc.", " */", "export function foo() {}", "const bar = 1;"].join(
      "\n",
    );
    expect(anchorHitsDeclaration(source, 5, "foo")).toBe(true);
    expect(anchorHitsDeclaration(source, 2, "foo")).toBe(true);
    expect(anchorHitsDeclaration(source, 3, "foo")).toBe(false);
    expect(anchorHitsDeclaration(source, 6, "foo")).toBe(false);
    expect(anchorHitsDeclaration(source, 6, "bar")).toBe(true);
    expect(anchorHitsDeclaration(source, 99, "bar")).toBe(false);
  });
});
