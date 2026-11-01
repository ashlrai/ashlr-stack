import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const comparison = readFileSync(join(root, "docs/changelog-apply-comparison.md"), "utf8");
const copies = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const title = "- **`stack apply` stops attempting to write placeholder secrets.**";

test("comparison cites the same complete 0.2.1 apply fix in both changelogs", () => {
  const entries = copies.map((path) => {
    expect(comparison).toContain(`](../${path}#021-2026-10-16)`);
    const changelog = readFileSync(join(root, path), "utf8");
    const release = changelog.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
    const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
    const entries = fixes?.split("\n").filter((line) => line.startsWith(title));
    expect(entries).toHaveLength(1);
    expect(fixes?.trimStart().startsWith(title)).toBe(true);
    return entries?.[0] ?? "";
  });
  expect(entries[0]).toBe(entries[1]);
  for (const claim of [
    "The wiring step never writes to the vault or fills in missing values.",
    "Provider setup may already store real values",
    "users must supply each required missing value themselves",
    "phantom list --json",
    "reports providers as skipped instead of identifying missing names",
    "every call failed and the printed `envelopes` count was always 0",
    "`WireResult.envelopes` is replaced by `present` and `missing`",
  ]) {
    expect(entries[0]).toContain(claim);
  }
  for (const topic of [
    "Wiring and setup",
    "Required values",
    "Readable vault",
    "Unreadable vault",
    "Previous behavior",
    "Result fields",
  ]) {
    expect(comparison).toContain(`| ${topic} |`);
  }
});
