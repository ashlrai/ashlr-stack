import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const docUrl = new URL("../../../../docs/apply-placeholder-history.md", import.meta.url);
const history = readFileSync(docUrl, "utf8");

test.each([
  [
    "../CHANGELOG.md",
    "010--2026-04-19-superseded-by-011",
    "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)",
    "- **`stack apply [recipe-id]`**",
  ],
  [
    "../packages/site/src/data/CHANGELOG.md",
    "010--2026-04-19-superseded-by-011",
    "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)",
    "- **`stack apply [recipe-id]`**",
  ],
  [
    "../CHANGELOG.md",
    "021-2026-10-16",
    "## 0.2.1 (2026-10-16)",
    "- **`stack apply` stops attempting to write placeholder secrets.**",
  ],
  [
    "../packages/site/src/data/CHANGELOG.md",
    "021-2026-10-16",
    "## 0.2.1 (2026-10-16)",
    "- **`stack apply` stops attempting to write placeholder secrets.**",
  ],
])("history links to the relevant entry in %s#%s", (path, anchor, heading, entryPrefix) => {
  expect(history).toContain(`](${path}#${anchor})`);
  const changelog = readFileSync(new URL(path, docUrl), "utf8");
  const release = changelog.split(`${heading}\n`)[1]?.split("\n## ")[0];
  expect(release).toBeDefined();
  const entry = release?.split("\n").find((line) => line.startsWith(entryPrefix));
  expect(entry).toContain("TODO_STACK_APPLY");
  expect(entry).toContain("failed");
  expect(entry).toMatch(
    /(?:does not write|never writes) to the vault or fills? (?:in )?missing values/,
  );
});
