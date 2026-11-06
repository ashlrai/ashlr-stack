import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries } from "./changelog-parser-utils";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const ENTRY = "Café résumé naïve façade: Zoë’s “señor” entry keeps its accents 🚀 and 👩‍💻 (#1).";
const site = read("../packages/site/src/data/CHANGELOG.md");
const fixture = read("./__fixtures__/changelog-site-unicode.md");

test("fixture entry retains accented characters and emoji", () => {
  const [group] = sectionEntries(fixture);
  expect(group.entries).toEqual([ENTRY]);
  expect(group.entries[0]).toContain("\u{1F680}");
  expect(group.entries[0]).toContain("\u{1F469}‍\u{1F4BB}"); // ZWJ sequence intact
});

test("site CHANGELOG.md plus the Unicode fixture entry parses with the entry intact", () => {
  // Add the fixture entry to the site file's Unreleased "Fixed" section, then parse the result.
  const marker = "### Fixed\n\n";
  const at = site.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const merged = `${site.slice(0, at + marker.length)}- ${ENTRY}\n${site.slice(at + marker.length)}`;
  const fixed = sectionEntries(merged).find((g) => g.version === "## Unreleased" && g.section === "Fixed");
  expect(fixed?.entries[0]).toBe(ENTRY);
  expect(fixed?.entries.length).toBe((sectionEntries(site).find((g) => g.section === "Fixed")?.entries.length ?? 0) + 1);
});

test("site CHANGELOG.md is valid UTF-8 and parsed entries lose no non-ASCII text", () => {
  const raw = readFileSync(new URL("../packages/site/src/data/CHANGELOG.md", import.meta.url));
  expect(raw.toString("utf8")).not.toContain("�");
  const lines = new Set(site.split("\n"));
  const entries = sectionEntries(site).flatMap((g) => g.entries);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) expect(lines.has(`- ${entry}`)).toBe(true);
  expect(entries.some((e) => /[^\x00-\x7F]/.test(e))).toBe(true);
});

test("parser does not normalize combining marks or CRLF-terminated Unicode entries", () => {
  const nfd = "Café résumé 日本語 مرحبا";
  const md = `## Unreleased\r\n\r\n### Fixed\r\n\r\n- ${nfd}\r\n`;
  const [group] = sectionEntries(md);
  expect(group.entries).toEqual([nfd]);
  expect(group.entries[0]).not.toBe(nfd.normalize("NFC"));
});
