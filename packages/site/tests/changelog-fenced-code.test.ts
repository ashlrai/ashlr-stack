import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");

/** Raw body of every `##` entry, keyed by its heading text. Only real headings split entries. */
function entryBodies(markdown: string): Map<string, string> {
  const bodies = new Map<string, string>();
  let current: string | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 ? token.text : null;
      if (current !== null) bodies.set(current, "");
    } else if (current !== null) {
      bodies.set(current, (bodies.get(current) ?? "") + token.raw);
    }
  }
  return bodies;
}

const fixture = [
  "# Changelog",
  "",
  "## 0.2.0 (2026-02-01)",
  "",
  "### Added",
  "",
  "- Shows the layout:",
  "",
  "```md",
  "## 9.9.9 (not a release)",
  "### Fake section",
  "# Fake title",
  "```",
  "",
  "~~~text",
  "## 8.8.8 (tilde fence)",
  "~~~",
  "",
  "## 0.1.0 (2026-01-01)",
  "",
  "- Older entry",
  "",
].join("\n");

test("heading-like lines inside a code fence stay in their entry body", () => {
  const bodies = entryBodies(fixture);
  expect([...bodies.keys()]).toEqual(["0.2.0 (2026-02-01)", "0.1.0 (2026-01-01)"]);
  const body = bodies.get("0.2.0 (2026-02-01)") ?? "";
  expect(body).toContain("## 9.9.9 (not a release)");
  expect(body).toContain("### Fake section");
  expect(body).toContain("# Fake title");
  expect(body).toContain("## 8.8.8 (tilde fence)");
  expect(bodies.get("0.1.0 (2026-01-01)")).not.toContain("9.9.9");
});

test("fenced heading-like lines produce code tokens, not heading tokens", () => {
  const tokens = marked.lexer(fixture);
  const headings = tokens.filter((t) => t.type === "heading").map((t) => t.raw.trim());
  expect(headings).toEqual(["# Changelog", "## 0.2.0 (2026-02-01)", "### Added", "## 0.1.0 (2026-01-01)"]);
  expect(tokens.filter((t) => t.type === "code")).toHaveLength(2);
});

test("published changelog: every fenced block stays inside one entry body", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const bodies = entryBodies(published);
  const fences = marked.lexer(published).filter((t) => t.type === "code");
  const inBodies = [...bodies.values()].reduce((n, b) => n + marked.lexer(b).filter((t) => t.type === "code").length, 0);
  expect(inBodies).toBe(fences.length);
});
