import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../.devin/wiki.json", import.meta.url), "utf8"));

describe("DeepWiki configuration", () => {
  test("has valid notes and a complete, unambiguous page hierarchy", () => {
    expect(Array.isArray(config.repo_notes)).toBe(true);
    expect(Array.isArray(config.pages)).toBe(true);
    expect(config.pages.length).toBeGreaterThan(0);
    expect(config.pages.length).toBeLessThanOrEqual(30);

    const titles = new Set<string>();
    for (const page of config.pages) {
      expect(typeof page.title).toBe("string");
      expect(page.title.trim().length).toBeGreaterThan(0);
      expect(titles.has(page.title)).toBe(false);
      expect(typeof page.purpose).toBe("string");
      expect(page.purpose.trim().length).toBeGreaterThan(0);
      // Requiring parents to precede children also prevents cycles.
      if (page.parent != null) expect(titles.has(page.parent)).toBe(true);
      titles.add(page.title);
    }

    const notes = [...config.repo_notes, ...config.pages.flatMap((page: { page_notes?: unknown[] }) => page.page_notes ?? [])];
    expect(notes.length).toBeLessThanOrEqual(100);
    for (const note of notes) {
      expect(typeof note.content).toBe("string");
      expect(note.content.length).toBeLessThanOrEqual(10_000);
    }
  });
});
