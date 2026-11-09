import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries } from "./changelog-parser-utils";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Body of each semver `##` section, keyed by its heading line (fenced code ignored). */
function versionBodies(md: string): Map<string, string> {
  const bodies = new Map<string, string>();
  let key: string | null = null;
  let fenced = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^##(?!#)/.test(line)) {
      key = /^## +\[?\d+\.\d+\.\d+/.test(line) ? line : null;
      if (key) bodies.set(key, "");
    } else if (key) {
      bodies.set(key, `${bodies.get(key)}${line}\n`);
    }
  }
  return bodies;
}

const fixture = read("./__fixtures__/changelog-unicode.md");

test("unicode fixture parses into the expected versions, Unreleased excluded", () => {
  expect([...versionBodies(fixture).keys()]).toEqual(["## 0.3.0 (2026-10-31)", "## [0.2.0] — 2026-04-23"]);
});

test("parsed version content preserves every Unicode character", () => {
  const bodies = versionBodies(fixture);
  const newer = bodies.get("## 0.3.0 (2026-10-31)") ?? "";
  for (const text of [
    "日本語のメモ: プロバイダーを追加 🚀 👩‍💻",
    "مرحبا بالعالم — שלום עולם",
    "Ελληνικά: αβγδ → ✓ done",
    "Ω ≠ µ",
  ]) {
    expect(newer).toContain(text);
  }
  expect(bodies.get("## [0.2.0] — 2026-04-23")).toBe("\n- Привет, мир — 你好，世界 🎉\n\n");
  expect(newer).not.toContain("Привет");
});

test("composed and decomposed accents are not normalised", () => {
  const body = versionBodies(fixture).get("## 0.3.0 (2026-10-31)") ?? "";
  expect(body).toContain("NFC é (U+00E9) vs NFD é (e + U+0301)");
  expect(body).toContain("é");
});

test("astral and ZWJ sequences keep their code points", () => {
  const body = versionBodies(fixture).get("## 0.3.0 (2026-10-31)") ?? "";
  expect([...body].filter((c) => (c.codePointAt(0) ?? 0) > 0xffff)).toContain("🚀");
  expect(body).toContain("\u{1F469}‍\u{1F4BB}");
});

test("CHANGELOG.md has no replacement characters and round-trips as UTF-8", () => {
  const raw = readFileSync(new URL("../CHANGELOG.md", import.meta.url));
  const text = raw.toString("utf8");
  expect(text).not.toContain("�");
  expect(Buffer.from(text, "utf8").equals(raw)).toBe(true);
  const nonAscii = [...versionBodies(text).values()].filter((b) => /[^\x00-\x7F]/.test(b));
  expect(nonAscii.length).toBeGreaterThan(0);
});

test("sectionEntries keeps Unicode entry text verbatim, under LF and CRLF", () => {
  const sections = sectionEntries(fixture);
  expect(sections).toEqual([
    {
      version: "## 0.3.0 (2026-10-31)",
      section: "Added",
      entries: [
        "日本語のメモ: プロバイダーを追加 🚀 👩‍💻",
        "مرحبا بالعالم — שלום עולם",
        "Ελληνικά: αβγδ → ✓ done",
      ],
    },
    { version: "## 0.3.0 (2026-10-31)", section: "Fixed", entries: ["NFC \u00e9 (U+00E9) vs NFD e\u0301 (e + U+0301), \u03a9 \u2260 \u00b5"] },
  ]);
  expect(sectionEntries(fixture.replace(/\n/g, "\r\n"))).toEqual(sections);
});

test("sectionEntries preserves combining characters in an entry", () => {
  const entry = "Decomposed cafe\u0301 and stacked a\u0323\u0301 remain unchanged";
  const markdown = `## Unreleased\n\n### Fixed\n\n- ${entry}\n`;
  const expected = [{ version: "## Unreleased", section: "Fixed", entries: [entry] }];

  expect(entry.normalize("NFC")).not.toBe(entry);
  expect(sectionEntries(markdown)).toEqual(expected);
  expect(sectionEntries(markdown.replace(/\n/g, "\r\n"))).toEqual(expected);
});

const ROOT_ENTRY = "Café résumé naïve: Zoë’s “señor” 日本語 مرحبا — entry keeps its Unicode text 🚀 👩‍💻 (#1).";

test("root-CHANGELOG fixture entry keeps its Unicode text", () => {
  const [group] = sectionEntries(read("./__fixtures__/changelog-root-unicode.md"));
  expect(group).toEqual({ version: "## Unreleased", section: "Fixed", entries: [ROOT_ENTRY] });
});

test("CHANGELOG.md plus the Unicode fixture entry parses with the entry intact, under LF and CRLF", () => {
  const root = read("../CHANGELOG.md");
  const marker = "### Fixed\n\n";
  const at = root.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const merged = `${root.slice(0, at + marker.length)}- ${ROOT_ENTRY}\n${root.slice(at + marker.length)}`;
  const find = (md: string) => sectionEntries(md).find((g) => g.version === "## Unreleased" && g.section === "Fixed");
  const before = find(root)?.entries ?? [];
  expect(find(merged)?.entries).toEqual([ROOT_ENTRY, ...before]);
  expect(find(merged.replace(/\n/g, "\r\n"))?.entries[0]).toBe(ROOT_ENTRY);
});

test("sectionEntries keeps invisible and separator characters, and Unicode section names, unchanged", () => {
  // ZWSP, ZWNJ, RLM, NBSP, LS and PS (must not split an entry), VS16, a tag character, trailing NBSP.
  const entry = "zero​width‌ joiner‏ rlm nbsp line sep para sep ❤️ \u{E0067} end ";
  const markdown = `## Unreleased\n\n### Ajouté — 追加\n\n- ${entry}\n- \`\`\`mid-line backticks stay in the entry\`\`\`\n`;
  const expected = [
    {
      version: "## Unreleased",
      section: "Ajouté — 追加",
      entries: [entry, "```mid-line backticks stay in the entry```"],
    },
  ];
  expect(sectionEntries(markdown)).toEqual(expected);
  expect(sectionEntries(markdown.replace(/\n/g, "\r\n"))).toEqual(expected);
});
