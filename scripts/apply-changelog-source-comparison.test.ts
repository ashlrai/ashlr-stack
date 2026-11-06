import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"] as const;
const title = "- **`stack apply` stops attempting to write placeholder secrets.**";

function applyFix(source: string): string {
  const release = source.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
  const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
  const entries = fixes?.split("\n").filter((line) => line.startsWith(title));
  expect(entries).toHaveLength(1);
  expect(fixes?.trimStart().startsWith(title)).toBe(true);
  return entries?.[0] ?? "";
}

test("source comparison locates and describes matching apply fix entries", () => {
  const report = read("docs/apply-changelog-source-comparison.md");
  const entries = paths.map((path) => {
    expect(report).toContain(`](../${path}#021-2026-10-16)`);
    return applyFix(read(path));
  });
  expect(entries[0]).toBe(entries[1]);
  expect(report).toContain("**Substantive wording differences: none.**");
  expect(report).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  for (const sourceWording of [
    "Provider setup may already store real values",
    "users must supply each required missing value themselves",
    "reports providers as skipped instead of identifying missing names",
    "every call failed and the printed `envelopes` count was always 0",
    "`WireResult.envelopes` is replaced by `present` and `missing`",
  ]) {
    expect(entries[0]).toContain(sourceWording);
  }
});

test("entry comparison detects wording changes in either source", () => {
  const sources = paths.map(read);
  const wording = "Provider setup may already store real values";
  for (const index of [0, 1]) {
    const changed = [...sources];
    expect(changed[index]).toContain(wording);
    changed[index] = changed[index].replace(wording, "Provider setup can already store real values");
    expect(applyFix(changed[0])).not.toBe(applyFix(changed[1]));
  }
});
