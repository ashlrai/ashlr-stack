import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"] as const;

// Match the historical fix as one list item, regardless of inline Markdown or wrapping.
function hasPlaceholderFix(changelog: string): boolean {
  const release = changelog.match(/^##\s+\[?0\.2\.1\]?(?:\s|$)[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m)?.[1];
  if (!release) return false;
  const items = release.match(/^\s*[-*+]\s+[^\n]*(?:\n(?!\s*[-*+]\s|\s*#{1,6}\s)[^\n]*)*/gm) ?? [];
  return items.some((item) => {
    const text = item.replace(/[`*_]/g, "").replace(/\s+/g, " ").toLowerCase();
    return (
      /stack apply stops attempting to write placeholder secrets\b/.test(text) &&
      /wiring step never writes to the vault or fills in missing values\b/.test(text)
    );
  });
}

test.each(paths)("%s retains the stack apply placeholder fix", (path) => {
  const changelog = readFileSync(join(import.meta.dir, "..", path), "utf8");
  expect(hasPlaceholderFix(changelog), `${path} lacks the stack apply placeholder fix in 0.2.1`).toBe(true);
});

test("placeholder fix detection accepts formatting differences within the entry", () => {
  const differentlyFormatted = `## [0.2.1] (2026-10-16)

### Bug fixes
* **stack apply** stops attempting to write
  placeholder secrets. The *wiring step never writes to the vault*
  or fills in missing values.
`;
  expect(hasPlaceholderFix(differentlyFormatted)).toBe(true);
});

test("placeholder fix detection requires both claims in the 0.2.1 entry", () => {
  const title = "- `stack apply` stops attempting to write placeholder secrets.";
  const behavior = "The wiring step never writes to the vault or fills in missing values.";
  for (const changelog of [
    `## 0.2.1\n${title}\n`,
    `## 0.2.1\n- ${behavior}\n`,
    `## 0.2.1\n${title}\n- ${behavior}\n`,
    `## 0.2.1\n${title}\n## 0.2.2\n- ${behavior}\n`,
    `## 0.2.2\n${title} ${behavior}\n`,
  ]) {
    expect(hasPlaceholderFix(changelog)).toBe(false);
  }
});
