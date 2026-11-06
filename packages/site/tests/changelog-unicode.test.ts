import { expect, test } from "bun:test";
import { marked } from "marked";

// Fixture lives in its own file: tests/changelog.test.ts is a contended hot file.
const version = "0.4.0";
const heading = `## ${version} (2026-11-02)`;
const entries = [
  "- Añadido `stack añadir` — soporte para «comillas» y ñ/ü/é (naïve café).",
  "- 日本語のエントリ: 設定ファイルを読み込む。",
  "- Emoji 🚀 and ZWJ family 👨‍👩‍👧 stay intact; combining e\u0301 (e + U+0301) too.",
  "- RTL שלום עולם and مرحبا بالعالم with “smart quotes” – en dash.",
];
const fixture = `# Changelog\n\n${heading}\n\n### Added\n\n${entries.join("\n")}\n\n## 0.3.0 (2026-10-31)\n\n- plain\n`;

function parse(markdown: string) {
  const tokens = marked.lexer(markdown);
  const releases = tokens.flatMap((t) =>
    t.type === "heading" && t.depth === 2 ? [t.text.match(/^\[?(\d+\.\d+\.\d+)\]?(?:\s|$)/)?.[1]] : [],
  );
  const items = tokens.flatMap((t) => (t.type === "list" ? t.items.map((i) => i.raw.trim()) : []));
  return { releases, items };
}

test("unicode changelog entries are retained exactly when parsed", () => {
  const { releases, items } = parse(fixture);
  expect(releases).toEqual([version, "0.3.0"]);
  expect(items.slice(0, entries.length)).toEqual(entries);
  // Code-point level checks: no normalization, no stripped joiners.
  expect(items[2]).toContain("\u{1F468}‍\u{1F469}‍\u{1F467}");
  expect(items[2]).toContain("é");
});

test("unicode entry text survives rendering to HTML", async () => {
  const html = await marked.parse(fixture);
  for (const text of ["日本語のエントリ: 設定ファイルを読み込む。", "שלום עולם", "مرحبا بالعالم", "“smart quotes” – en dash"]) {
    expect(html).toContain(text);
  }
  expect(html).toContain("<code>stack añadir</code>");
});
