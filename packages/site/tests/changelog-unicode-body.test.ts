import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");

/**
 * Raw markdown body of each version section, keyed by heading text. A body
 * runs from the line after a semver `##` heading to the next `##` heading.
 */
function versionBodies(markdown: string): Map<string, string> {
  const bodies = new Map<string, string>();
  let key: string | null = null;
  let start = 0;
  for (const token of marked.lexer(markdown)) {
    const end = start + token.raw.length;
    if (token.type === "heading" && token.depth <= 2) {
      key = token.depth === 2 && /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/.test(token.text) ? token.text : null;
    } else if (key !== null) {
      bodies.set(key, (bodies.get(key) ?? "") + token.raw);
    }
    start = end;
  }
  return bodies;
}

// Accents, CJK, emoji (astral plane, ZWJ sequence), RTL, combining marks.
const fixture = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "- Ünreleased — naïve café ☕",
  "",
  "## 0.2.0 (2026-02-02)",
  "",
  "### Added",
  "",
  "- 日本語のメモ: プロバイダーを追加 🚀 👩‍💻",
  "- مرحبا بالعالم — שלום עולם",
  "- Combining: é (not é), Ω ≠ µ, “quotes” and ‘ticks’",
  "",
  "## [0.1.0] — 2026-01-01",
  "",
  "- Ελληνικά: αβγ — first release 🎉",
  "",
].join("\n");

test("unicode text stays in the version body it was written under", () => {
  const bodies = versionBodies(fixture);
  expect([...bodies.keys()]).toEqual(["0.2.0 (2026-02-02)", "[0.1.0] — 2026-01-01"]);

  const newer = bodies.get("0.2.0 (2026-02-02)") ?? "";
  for (const text of ["日本語のメモ", "🚀", "👩‍💻", "مرحبا بالعالم", "שלום עולם", "é", "Ω ≠ µ", "“quotes”"]) {
    expect(newer).toContain(text);
  }
  expect(newer).not.toContain("Ελληνικά");
  expect(newer).not.toContain("Ünreleased");

  const older = bodies.get("[0.1.0] — 2026-01-01") ?? "";
  expect(older).toContain("Ελληνικά: αβγ — first release 🎉");
  expect(older).not.toContain("日本語");
});

test("unicode bodies render to HTML without loss", async () => {
  const bodies = versionBodies(fixture);
  const html = await marked.parse(bodies.get("0.2.0 (2026-02-02)") ?? "");
  expect(html).toContain("日本語のメモ: プロバイダーを追加 🚀 👩‍💻");
  expect(html).toContain("é");
  expect(html).not.toContain("�");
});

test("site changelog keeps its non-ASCII text, unreplaced, in a version body", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(published).not.toContain("�");
  const bodies = versionBodies(published);
  const withUnicode = [...bodies.entries()].filter(([, body]) => /[^\x00-\x7F]/.test(body));
  expect(withUnicode.length).toBeGreaterThan(0);
  // The `✗ No .stack.toml` message is documented under 0.2.1.
  expect(bodies.get("0.2.1 (2026-10-16)")).toContain("✗ No .stack.toml at <path>");
});
