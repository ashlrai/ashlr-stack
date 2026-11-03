import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";

/** `## version / ### section` mapped to its list entries, in source order. */
function parseEntries(markdown: string): [string, string[]][] {
  const out: [string, string[]][] = [];
  let version = "";
  for (const token of marked.lexer(markdown) as Token[]) {
    if (token.type === "heading" && token.depth === 2) version = token.text;
    else if (token.type === "heading" && token.depth === 3) out.push([`${version} / ${token.text}`, []]);
    else if (token.type === "list" && out.length) {
      out[out.length - 1]?.[1].push(...token.items.map((i: { text: string }) => i.text.trim()));
    }
  }
  return out;
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-blank-line-site-entries.md"), "utf8");

test("two entries split by a blank line are both retained, in order", () => {
  expect(parseEntries(fixture)).toEqual([
    [
      "Unreleased / Fixed",
      [
        "Fleet JSONL reads (`stack fleet` diagnostics) now enforce the byte cap while reading (#360).",
        "The release workflow renders the Homebrew formula placeholders (`$VERSION$`) as literals through `sed` (#354).",
      ],
    ],
    ["0.3.0 (2026-10-31) / Added", ["Fleet diagnostics: lanes, supply, latency."]],
  ]);
});

test("the fixture entries match the real site changelog's opening Fixed entries", () => {
  const real = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const fixed = parseEntries(real).find(([k]) => k === "Unreleased / Fixed")?.[1] ?? [];
  const [fixtureFixed] = parseEntries(fixture);
  const lead = (s: string) => s.slice(0, 40);
  expect(fixed.map(lead)).toEqual(expect.arrayContaining((fixtureFixed?.[1] ?? []).map(lead)));
  expect(fixed.findIndex((e) => lead(e) === lead(fixtureFixed?.[1][0] ?? ""))).toBeLessThan(
    fixed.findIndex((e) => lead(e) === lead(fixtureFixed?.[1][1] ?? "")),
  );
});
