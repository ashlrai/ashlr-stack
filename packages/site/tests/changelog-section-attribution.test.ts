import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");

const historicalApplyPrefix = "- **`stack apply [recipe-id]`**";
const placeholderRemovalPrefix =
  "- **`stack apply` stops attempting to write placeholder secrets.**";

/**
 * Texts of the `##` version headings containing each list entry that starts
 * with `prefix`, in file order. An entry contributes null when it sits outside
 * all version sections: before the first `##` heading, under `## Unreleased`
 * or another non-version `##` heading, or after a `#` heading resets the
 * enclosing release.
 */
function entryReleases(markdown: string, prefix: string): (string | null)[] {
  let release: string | null = null;
  const releases: (string | null)[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      release =
        token.depth === 2 && /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/.test(token.text)
          ? token.text
          : null;
    }
    if (token.type === "list") {
      for (const item of token.items) {
        if (item.raw.startsWith(prefix)) releases.push(release);
      }
    }
  }
  return releases;
}

const changelogs = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

test.each(changelogs)(
  "%s keeps the historical stack apply placeholder entry inside a version section",
  (path) => {
    const changelog = readFileSync(join(root, path), "utf8");
    const releases = entryReleases(changelog, historicalApplyPrefix);
    expect(releases).toHaveLength(1);
    expect(releases).not.toContain(null);
    expect(releases[0]).toBe("0.1.0 — 2026-04-19 (superseded by 0.1.1)");
  },
);

test.each(changelogs)(
  "%s keeps the apply placeholder-removal entry inside a version section",
  (path) => {
    const changelog = readFileSync(join(root, path), "utf8");
    const releases = entryReleases(changelog, placeholderRemovalPrefix);
    expect(releases).toHaveLength(1);
    expect(releases).not.toContain(null);
    expect(releases[0]).toBe("0.2.1 (2026-10-16)");
  },
);

test("entry release attribution marks entries outside version sections as null", () => {
  const entry = `${placeholderRemovalPrefix} fix body`;
  expect(entryReleases(`${entry}\n`, placeholderRemovalPrefix)).toEqual([null]);
  expect(
    entryReleases(`## Unreleased\n\n### Fixed\n\n${entry}\n`, placeholderRemovalPrefix),
  ).toEqual([null]);
  expect(
    entryReleases(`## 0.2.1 (2026-10-16)\n\n### Bug fixes\n\n${entry}\n`, placeholderRemovalPrefix),
  ).toEqual(["0.2.1 (2026-10-16)"]);
  expect(entryReleases(`## 0.2.1\n\n# Title\n\n${entry}\n`, placeholderRemovalPrefix)).toEqual([
    null,
  ]);
  expect(
    entryReleases(`## 0.2.1\n\n\`\`\`md\n${entry}\n\`\`\`\n`, placeholderRemovalPrefix),
  ).toEqual([]);
});
