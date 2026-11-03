import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import { latestReleaseFromChangelog } from "../scripts/gen-site-facts";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-final-entry-no-newline.md"), "utf8");
// The same H1 strip the /docs/changelog page applies before rendering.
const render = (md: string) => marked.parse(md.replace(/^#\s+Changelog\s*\n+/, ""), { gfm: true, breaks: false }) as string;

test("fixture really ends mid-line, inside the final entry", () => {
  expect(fixture.endsWith("\n")).toBe(false);
  expect(fixture.endsWith("`code`")).toBe(true);
});

test("the docs page renders the final entry fully, links and code included", () => {
  const html = render(fixture);
  expect(html).toContain('<li>Only entry, ends in a <a href="https://example.com/final">link</a> and <code>code</code></li>');
  expect(html).toContain("<h2>0.2.0 (2026-02-01)</h2>");
});

test("a trailing newline does not change the rendered page", () => {
  expect(render(`${fixture}\n`).trim()).toBe(render(fixture).trim());
});

test("the site-facts release lookup still picks the newest release", () => {
  expect(latestReleaseFromChangelog(fixture)).toEqual({ version: "0.3.0", date: "2026-03-01", scope: "source-changelog" });
});
