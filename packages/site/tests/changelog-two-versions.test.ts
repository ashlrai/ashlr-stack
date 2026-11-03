import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-two-versions.md"), "utf8");

type Release = { version: string; entries: string[] };

/** Each `##` version with every list entry under it (all `###` sections flattened), in source order. */
function parseReleases(markdown: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 ? { version: token.text, entries: [] } : null;
      if (current) releases.push(current);
    } else if (token.type === "list" && current) {
      current.entries.push(...(token as Tokens.List).items.map((item) => item.text));
    }
  }
  return releases;
}

test("both versions keep their own entries, in source order", () => {
  expect(parseReleases(fixture)).toEqual([
    { version: "0.10.0 (2026-11-02)", entries: ["Shared entry text.", "Only in 0.10.0.", "Shared fix text."] },
    { version: "0.9.0 (2026-10-20)", entries: ["Shared entry text.", "Only in 0.9.0.", "Shared fix text."] },
  ]);
});

test("entries with identical text stay attached to their own version", () => {
  const [newer, older] = parseReleases(fixture);
  expect(newer?.entries).not.toContain("Only in 0.9.0.");
  expect(older?.entries).not.toContain("Only in 0.10.0.");
  expect(newer?.entries.filter((e) => e === "Shared entry text.")).toHaveLength(1);
  expect(older?.entries.filter((e) => e === "Shared entry text.")).toHaveLength(1);
});

test("0.10.0 stays ahead of 0.9.0 as written (no numeric or lexical re-sorting)", () => {
  expect(parseReleases(fixture).map((r) => r.version.split(" ")[0])).toEqual(["0.10.0", "0.9.0"]);
});

test("site changelog: its two newest released versions list entries in file order", () => {
  const path = join(import.meta.dir, "../src/data/CHANGELOG.md");
  const raw = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const [first, second] = parseReleases(raw).filter((r) => /^\[?\d+\.\d+\.\d+/.test(r.version));
  expect(first?.entries.length).toBeGreaterThan(0);
  expect(second?.entries.length).toBeGreaterThan(0);
  // Each release's entries must start at increasing offsets, and the first release must precede the second.
  let from = 0;
  for (const release of [first, second]) {
    for (const entry of release.entries) {
      const at = raw.indexOf(entry.split("\n")[0].slice(0, 40), from);
      expect(at, `${release.version}: ${entry.slice(0, 40)}`).toBeGreaterThanOrEqual(from);
      from = at;
    }
  }
});
