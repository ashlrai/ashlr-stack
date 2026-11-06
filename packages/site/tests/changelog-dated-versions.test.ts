import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");

const VERSION = /^\[?(\d+\.\d+\.\d+)\]?(?:\s|$)/;

interface Release {
  version: string;
  date: string | null;
  items: string[];
}

/** Each released version with the date from its own heading and the list items of its own body. */
function parseReleases(markdown: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      const version = token.depth === 2 ? VERSION.exec(token.text)?.[1] : undefined;
      current = version
        ? { version, date: token.text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? null, items: [] }
        : null;
      if (current) releases.push(current);
    } else if (current && token.type === "list") {
      current.items.push(...token.items.map((i: { text: string }) => i.text));
    }
  }
  return releases;
}

test("dated-version fixture ties each date and body to its own version", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-dated-versions.md"), "utf8");
  expect(parseReleases(fixture)).toEqual([
    {
      version: "0.4.0",
      date: "2026-11-01",
      items: ["Body of 0.4.0 mentions an older date 2026-10-01 and the version 0.3.0."],
    },
    { version: "0.3.0", date: "2026-10-31", items: ["Body of 0.3.0."] },
    { version: "0.2.0", date: "2026-04-23", items: ["Body of 0.2.0."] },
    { version: "0.1.0", date: null, items: ["Undated release body."] },
  ]);
});

test("Unreleased section and its date-like text never attach to a version", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-dated-versions.md"), "utf8");
  const all = parseReleases(fixture);
  expect(all.flatMap((r) => r.items).some((i) => i.includes("2026-12-31"))).toBe(false);
  expect(all.some((r) => r.date === "2026-12-31")).toBe(false);
});

test("site changelog: the newest dated release has a date and a non-empty body", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const releases = parseReleases(published);
  expect(releases.length).toBeGreaterThan(0);
  expect(releases[0].date).not.toBeNull();
  expect(releases[0].items.length).toBeGreaterThan(0);
});
