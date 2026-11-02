import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const reference = readFileSync(join(root, "docs/apply-changelog-version-reference.md"), "utf8");
const heading = "0.2.1 (2026-10-16)";
const entry = "- **`stack apply` stops attempting to write placeholder secrets.**";

test("each linked source places the removal entry under the documented version", () => {
  for (const source of ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"]) {
    const row = reference.split("\n").find((line) => line.includes(`](../${source}#021-2026-10-16)`));
    expect(row, `missing version link for ${source}`).toContain(`\`${heading}\``);

    const changelog = readFileSync(join(root, source), "utf8");
    const sections = changelog.split(/^## /m).filter((section) => section.includes(entry));
    expect(sections).toHaveLength(1);
    expect(sections[0].startsWith(`${heading}\n`)).toBe(true);
    const fixes = sections[0].split(/^### Bug fixes\n/m)[1]?.split(/^### /m)[0];
    expect(fixes?.trimStart().startsWith(entry)).toBe(true);
  }
});

test("reference distinguishes the changelog heading from npm publication", () => {
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const release = changelog.split("## 0.2.2 (2026-10-25)\n")[1]?.split("\n## ")[0];
  expect(release).toContain("0.2.1 was tagged but its npm publish failed");
  expect(release).toContain("ships everything listed here and under 0.2.1 below");
  expect(reference).toContain("](../CHANGELOG.md#022-2026-10-25)");
  expect(reference).toContain("0.2.1 was tagged but its npm publish failed");
  expect(reference).toContain("0.2.2 includes its changes");
});
