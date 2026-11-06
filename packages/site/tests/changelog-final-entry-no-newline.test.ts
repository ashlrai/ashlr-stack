import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Token } from "marked";
import { latestReleaseFromChangelog } from "../scripts/gen-site-facts";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-final-entry-no-newline.md"), "utf8");
// The same H1 strip the /docs/changelog page applies before rendering.
const render = (md: string) => marked.parse(md.replace(/^#\s+Changelog\s*\n+/, ""), { gfm: true, breaks: false }) as string;

const VERSION = /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/;

/** Released versions in source order; `raw` is the body's exact source text. */
function parseVersions(markdown: string): { heading: string; body: Token[]; raw: string }[] {
  const versions: { heading: string; body: Token[]; raw: string }[] = [];
  let current: { heading: string; body: Token[]; raw: string } | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 && VERSION.test(token.text) ? { heading: token.text, body: [], raw: "" } : null;
      if (current) versions.push(current);
    } else if (current) {
      current.body.push(token);
      current.raw += token.raw;
    }
  }
  return versions;
}

test("fixture really ends mid-line, inside the final entry", () => {
  expect(fixture.endsWith("\n")).toBe(false);
  expect(fixture.endsWith("`code`")).toBe(true);
});

test("final version entry is returned intact even without a trailing newline", () => {
  const versions = parseVersions(fixture);
  expect(versions.map((v) => v.heading)).toEqual(["0.3.0 (2026-03-01)", "0.2.0 (2026-02-01)"]);

  const last = versions[versions.length - 1];
  expect(last.heading).toBe("0.2.0 (2026-02-01)");
  // Raw body text carries the final entry with [link]... and `code` — no truncation.
  expect(last.raw).toContain("- Only entry, ends in a [link](https://example.com/final) and `code`");
  expect(last.raw.endsWith("\n")).toBe(false);
  // Body tokens: space, ### Added, space, list (with 1 item).
  expect(last.body.map((t) => t.type)).toEqual(["space", "heading", "space", "list"]);
  const list = last.body.find((t) => t.type === "list") as { items: { text: string }[] } | undefined;
  expect(list?.items.map((i) => i.text.trim())).toEqual([
    "Only entry, ends in a [link](https://example.com/final) and `code`",
  ]);
});

test("the docs page renders the final entry fully, links and code included", () => {
  const html = render(fixture);
  expect(html).toContain('<li>Only entry, ends in a <a href="https://example.com/final">link</a> and <code>code</code></li>');
  expect(html).toContain("<h2>0.2.0 (2026-02-01)</h2>");
});

test("a trailing newline does not change parsed list-item text or rendered HTML", () => {
  const raw1 = parseVersions(fixture).pop()!;
  const raw2 = parseVersions(`${fixture}\n`).pop()!;
  // `raw` differs (extra \n), but list-item text is identical.
  const items1 = raw1.body.find((t) => t.type === "list") as { items: { text: string }[] } | undefined;
  const items2 = raw2.body.find((t) => t.type === "list") as { items: { text: string }[] } | undefined;
  expect(items1?.items.map((i) => i.text.trim())).toEqual(items2?.items.map((i) => i.text.trim()));
  // Rendered HTML is identical after trim.
  expect(render(`${fixture}\n`).trim()).toBe(render(fixture).trim());
});

test("the site-facts release lookup still picks the newest release", () => {
  expect(latestReleaseFromChangelog(fixture)).toEqual({ version: "0.3.0", date: "2026-03-01", scope: "source-changelog" });
});
