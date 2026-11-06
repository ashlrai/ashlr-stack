import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-heading-prose.md"), "utf8");

/**
 * Raw markdown body of each version section, keyed by heading text. Only a
 * semver `##` heading, `## Unreleased` or the `#` title opens or closes a
 * section; any other heading (or heading-like prose) stays in the open body.
 */
function versionBodies(markdown: string): Map<string, string> {
  const bodies = new Map<string, string>();
  let key: string | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      const boundary =
        token.depth === 1 || /^(?:\[?\d+\.\d+\.\d+\]?(?:\s|$)|Unreleased$)/.test(token.text);
      if (boundary) {
        key = token.depth === 2 ? token.text : null;
        continue;
      }
    }
    if (key !== null) bodies.set(key, (bodies.get(key) ?? "") + token.raw);
  }
  return bodies;
}

test("a non-version ## heading stays in the version body above it", () => {
  const bodies = versionBodies(fixture);
  expect([...bodies.keys()]).toEqual(["Unreleased", "0.5.0 (2026-11-02)", "0.4.0 — 2026-10-01"]);

  const body = bodies.get("0.5.0 (2026-11-02)") ?? "";
  expect(body).toContain("## Migration notes");
  expect(body).toContain("Run `stack apply` again after upgrading.");
  expect(body).toContain("## 2026 retrospective");
  expect(body).toContain("Still part of 0.5.0.");
});

test("deeper headings, hashtag prose, setext lines and fenced versions stay put", () => {
  const body = versionBodies(fixture).get("0.5.0 (2026-11-02)") ?? "";
  for (const text of [
    "### Added",
    "#hashtag-not-a-heading",
    "Setext-looking line",
    "```md\n## 9.9.9 (2026-01-01)\n```",
  ]) {
    expect(body).toContain(text);
  }
});

test("neighbouring versions do not absorb the heading-like text", () => {
  const bodies = versionBodies(fixture);
  expect(bodies.get("Unreleased")?.trim()).toBe("- Pending entry.");
  expect(bodies.get("0.4.0 — 2026-10-01")).not.toContain("Migration notes");
  expect(bodies.has("9.9.9 (2026-01-01)")).toBe(false);
});
