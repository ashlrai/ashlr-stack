import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const VERSION = /^\[?(\d+\.\d+\.\d+)\]?(?:\s|$)/;
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-unicode-entry.md"), "utf8");
const real = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** Version number (from the `##` heading) mapped to its list entries' raw text. */
function parse(markdown: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth === 2) {
      const v = VERSION.exec(t.text)?.[1];
      current = v ? [] : null;
      if (v && current) out.set(v, current);
    } else if (current && t.type === "list") {
      for (const item of t.items) current.push(item.text);
    }
  }
  return out;
}

const expected = new Map([
  [
    "4.1.0",
    [
      "Café decomposed (NFD) stays decomposed; Café composed stays composed.",
      "Astral plane: \u{1D54F} \u{1F468}‍\u{1F469}‍\u{1F467} and RTL שלום `設定`.",
    ],
  ],
  ["4.0.0", ["日本語のエントリ。"]],
]);

test("unicode entries keep exact code points and their version", () => {
  const parsed = parse(fixture);
  expect([...parsed.keys()]).toEqual(["4.1.0", "4.0.0"]);
  expect(parsed.get("4.1.0")).toEqual(expected.get("4.1.0"));
  expect(parsed.get("4.0.0")).toEqual(expected.get("4.0.0"));
});

test("NFD and NFC forms are not normalised to each other", () => {
  const [nfd] = parse(fixture).get("4.1.0") ?? [];
  expect(nfd).toContain("Café");
  expect(nfd).toContain("Café");
  expect(nfd).not.toBe(nfd?.normalize("NFC"));
});

test("unicode survives CRLF line endings and a leading BOM", () => {
  const crlf = fixture.replace(/\n/g, "\r\n");
  expect(parse(crlf)).toEqual(parse(fixture));
  expect(JSON.stringify([...parse(crlf)])).not.toContain("\\r");
  const bom = parse(`﻿${fixture}`);
  expect(bom.get("4.1.0")).toEqual(expected.get("4.1.0"));
});

test("the site CHANGELOG.md keeps its versions when the unicode section is prepended", () => {
  const baseline = parse(real);
  expect(baseline.size).toBeGreaterThan(0);
  const combined = parse(fixture.trimEnd() + "\n\n" + real.replace(/^# Changelog\s*/, ""));
  expect(combined.get("4.1.0")).toEqual(expected.get("4.1.0"));
  for (const [version, entries] of baseline) expect(combined.get(version)).toEqual(entries);
});
