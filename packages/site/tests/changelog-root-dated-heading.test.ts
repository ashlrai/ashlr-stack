import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-root-dated-heading.md"), "utf8");

interface Release {
  version: string;
  date: string | null;
  items: string[];
}

/** Dated releases only: `## 0.3.0 (2026-10-31)`, `## [0.2.0] — 2026-04-23`. Unreleased gets no entry. */
function parseReleases(markdown: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      const m = token.depth === 2 ? /^\[?(\d+\.\d+\.\d+)\]?/.exec(token.text) : null;
      current = m ? { version: m[1], date: token.text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, items: [] } : null;
      if (current) releases.push(current);
    } else if (current && token.type === "list") {
      current.items.push(...token.items.map((i: { text: string }) => i.text));
    }
  }
  return releases;
}

test("date and entries attach to the version whose heading carries them", () => {
  const [v030, v020] = parseReleases(fixture);
  expect(v030.version).toBe("0.3.0");
  expect(v030.date).toBe("2026-10-31");
  expect(v030.items).toHaveLength(3);
  expect(v030.items[0]).toStartWith("`stack doctor --repos` reports");
  expect(v020).toEqual({
    version: "0.2.0",
    date: "2026-04-23",
    items: ["Entry that belongs to 0.2.0, dated 2026-04-23."],
  });
});

test("Unreleased entries are never attributed to a version", () => {
  const all = parseReleases(fixture);
  expect(all.map((r) => r.version)).toEqual(["0.3.0", "0.2.0"]);
  expect(all.flatMap((r) => r.items).join("\n")).not.toContain("Unreleased entry");
});

test("fixture 0.3.0 entries are verbatim from the real CHANGELOG.md under the same dated heading", () => {
  const real = parseReleases(readFileSync(join(root, "CHANGELOG.md"), "utf8")).find((r) => r.version === "0.3.0");
  expect(real?.date).toBe("2026-10-31");
  for (const item of parseReleases(fixture)[0].items) expect(real?.items).toContain(item);
});
