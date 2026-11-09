import { describe, expect, test } from "bun:test";
import { DOCS_NAV } from "../src/lib/docs-nav";

describe("docs navigation destinations", () => {
  const entries = DOCS_NAV.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.title })),
  );

  test("are nonempty", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.href.trim().length, `${entry.group} / ${entry.label}: ${JSON.stringify(entry.href)}`).toBeGreaterThan(0);
    }
  });

  test("are unique across groups", () => {
    const seen = new Set<string>();
    for (const entry of entries) {
      expect(seen.has(entry.href), `Duplicate destination: ${JSON.stringify(entry.href)}`).toBe(false);
      seen.add(entry.href);
    }
  });
});
