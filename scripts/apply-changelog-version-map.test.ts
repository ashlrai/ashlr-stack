import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const map = readFileSync(join(root, "docs/apply-changelog-version-map.md"), "utf8");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const heading = "0.2.1 (2026-10-16)";
const entry = "- **`stack apply` stops attempting to write placeholder secrets.**";

test("each linked changelog places the placeholder fix under the mapped version", () => {
  for (const source of sources) {
    const row = map.split("\n").find((line) => line.includes(`](../${source}#021-2026-10-16)`));
    expect(row, `missing link for ${source}`).toBeDefined();
    expect(row).toContain(`\`${heading}\``);
    expect(row).toContain("`Bug fixes`");

    const text = readFileSync(join(root, source), "utf8");
    const sections = text.split(/^## /m);
    const matching = sections.filter((section) => section.includes(entry));
    expect(matching).toHaveLength(1);
    expect(matching[0].startsWith(`${heading}\n`)).toBe(true);
    const fixes = matching[0].split(/^### Bug fixes\n/m);
    expect(fixes.length).toBeGreaterThan(1);
    expect(fixes[1].trimStart().startsWith(entry)).toBe(true);
  }
});

test("the version map distinguishes the recorded version from publication", () => {
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const release = changelog.split("## 0.2.2 (2026-10-25)\n")[1]?.split("\n## ")[0];
  expect(release).toContain("0.2.1 was tagged but its npm publish failed");
  expect(release).toContain("ships everything listed here and under 0.2.1 below");
  expect(map).toContain("0.2.1 was tagged but not");
  expect(map).toContain("0.2.2 includes its changes");
});
