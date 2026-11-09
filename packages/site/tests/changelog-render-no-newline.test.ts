import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

// Mirrors src/pages/docs/changelog.astro: strip the H1, then render with marked.
async function render(markdown: string): Promise<string> {
  const body = markdown.replace(/^#\s+Changelog\s*\n+/, "");
  return marked.parse(body, { gfm: true, breaks: false });
}

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-render-no-newline.md"), "utf8");

test("fixture really ends without a trailing newline", () => {
  expect(fixture.endsWith("\n")).toBe(false);
  expect(fixture.endsWith("on the last line")).toBe(true);
});

test("page render keeps the whole final entry (inline code, link, wrapped line)", async () => {
  const html = await render(fixture);
  expect(html).not.toContain("<h1");
  expect(html).toContain("<h2>0.1.0 (2026-01-01)</h2>");
  expect(html).toContain("<code>inline code</code>");
  expect(html).toContain('<a href="https://stack.ashlr.ai/docs">link</a>');
  expect(html.trimEnd().endsWith("</li>\n</ul>")).toBe(true);
});

test("rendered HTML is identical with or without the final newline", async () => {
  expect((await render(`${fixture}\n`)).trimEnd()).toBe((await render(fixture)).trimEnd());
});

test("a final Unicode entry without a trailing newline renders in full once", async () => {
  const entry = "Café — 日本語 🚀 and decomposed e\u0301";
  const unicodeFixture = `# Changelog\n\n## 0.1.0 (2026-01-01)\n\n- ${entry}`;
  expect(unicodeFixture.endsWith("\n")).toBe(false);

  const html = await render(unicodeFixture);
  expect(html.match(/<li>/g)).toHaveLength(1);
  expect(html).toContain(`<li>${entry}</li>`);
  expect(html).toBe(await render(`${unicodeFixture}\n`));
});

test("published changelog renders its last entry with the trailing newline removed", async () => {
  const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const stripped = published.replace(/\n+$/, "");
  expect((await render(stripped)).trimEnd()).toBe((await render(published)).trimEnd());
});
