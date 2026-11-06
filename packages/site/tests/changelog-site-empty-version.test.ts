import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

type Section = { name: string; items: string[] };
type Release = { heading: string; sections: Section[]; loose: string[] };

/** Every `##` release with its `###` sections and list items; list items outside a section are `loose`. */
function parse(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: Section | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      section = null;
      release = token.depth === 2 ? { heading: token.text, sections: [], loose: [] } : null;
      if (release) releases.push(release);
    } else if (token.type === "heading" && token.depth === 3 && release) {
      section = { name: token.text, items: [] };
      release.sections.push(section);
    } else if (token.type === "list" && release) {
      for (const item of token.items) (section?.items ?? release.loose).push(item.text);
    }
  }
  return releases;
}

const entryCount = (r: Release) => r.loose.length + r.sections.reduce((n, s) => n + s.items.length, 0);

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-site-empty-version.md"), "utf8");

test("a version with no entries is listed with no sections and no invented entries", () => {
  const empty = parse(fixture).find((r) => r.heading === "0.3.1 (2026-11-01)");
  expect(empty).toEqual({ heading: "0.3.1 (2026-11-01)", sections: [], loose: [] });
});

test("neighbouring releases keep exactly their own entries", () => {
  const [unreleased, , v030] = parse(fixture);
  expect(unreleased.sections).toEqual([
    { name: "Changed", items: ["`stack apply` does not create placeholder secrets."] },
  ]);
  expect(v030.sections.map((s) => s.name)).toEqual(["Added", "Fixed"]);
  expect(entryCount(v030)).toBe(2);
});

test("emptying a real release of the site changelog keeps its heading and adds nothing", () => {
  const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const before = parse(published);
  const target = before.find((r) => /^0\.3\.0\b/.test(r.heading));
  expect(target).toBeDefined();
  expect(entryCount(target as Release)).toBeGreaterThan(0);

  // Drop everything between the 0.3.0 heading and the next `##` heading.
  const emptied = published.replace(/(^## 0\.3\.0[^\n]*\n)[\s\S]*?(?=^## )/m, "$1\n");
  const after = parse(emptied);

  expect(after.map((r) => r.heading)).toEqual(before.map((r) => r.heading));
  expect(after.find((r) => /^0\.3\.0\b/.test(r.heading))).toEqual({
    heading: (target as Release).heading,
    sections: [],
    loose: [],
  });
  // Every other release is unchanged.
  expect(after.filter((r) => !/^0\.3\.0\b/.test(r.heading))).toEqual(
    before.filter((r) => !/^0\.3\.0\b/.test(r.heading)),
  );
});

test("the empty version renders as a heading with no list or text after it", async () => {
  const html = await marked.parse(fixture);
  const afterEmpty = html.split("<h2>0.3.1 (2026-11-01)</h2>")[1].split("<h2>")[0];
  expect(afterEmpty.trim()).toBe("");
});
