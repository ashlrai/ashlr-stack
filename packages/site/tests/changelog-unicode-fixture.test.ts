import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const VERSION = /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/;
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-unicode-body.md"), "utf8");

/** Each semver `##` heading (exact text) with the plain text of its list entries. */
function parse(markdown: string): { heading: string; entries: string[] }[] {
  const out: { heading: string; entries: string[] }[] = [];
  let current: { heading: string; entries: string[] } | null = null;
  for (const t of marked.lexer(markdown)) {
    if (t.type === "heading" && t.depth === 2) {
      current = VERSION.test(t.text) ? { heading: t.text, entries: [] } : null;
      if (current) out.push(current);
    } else if (current && t.type === "list") {
      for (const item of t.items) current.entries.push(item.text);
    }
  }
  return out;
}

test("unicode versions and entry text are retained exactly", () => {
  expect(parse(fixture)).toEqual([
    {
      heading: "2.0.0 (2026-10-15)",
      entries: [
        "日本語サポート: 日本語のテキストと絵文字 🌏 をサポート",
        "Internationalization: résumé naïve señor — accented text in release notes",
        "Math formula: β = σ(αx + b) for activation function",
        "🔧 Fixed memory leak in worker process",
        "Russian locale: исправлена ошибка в кириллическом вводе",
      ],
    },
    {
      heading: "1.0.0 (2026-05-01)",
      entries: [
        "🚀 Initial release! Launch day 🎊",
        "Arabic greeting: مرحباً بالعالم (hello world)",
        "Emoji in headings now render: 🐛 fixed",
      ],
    },
    {
      heading: "0.5.0 (2026-01-15)",
      entries: [
        "CJK characters: 新增中文本地化，测试 Unicode 处理",
        "Greek test: αβγδεζ — Greek alphabet support verified",
      ],
    },
  ]);
});

test("unicode entries are not replaced, normalised or split", () => {
  const text = JSON.stringify(parse(fixture));
  expect(text).not.toContain("�");
  expect(text).not.toContain("\\u"); // no escaping
  for (const entry of parse(fixture).flatMap((v) => v.entries)) expect(entry).toBe(entry.normalize("NFC"));
});

test("a code fence holding unicode list text does not add an entry or version", () => {
  const all = parse(fixture).flatMap((v) => v.entries);
  expect(all.some((e) => e.includes("🍕"))).toBe(false);
  expect(parse(fixture).map((v) => v.heading)).not.toContain("This is a code block — should not be parsed as heading");
});

test("the unreleased entry is not attributed to any version", () => {
  expect(parse(fixture).flatMap((v) => v.entries).some((e) => e.includes("Exciting new feature"))).toBe(false);
});
