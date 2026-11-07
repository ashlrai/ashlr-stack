import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const title = "- **`stack apply` stops attempting to write placeholder secrets.**";

test("cross-reference links to both copies of the placeholder wiring fix", () => {
  const reference = read("docs/apply-changelog-cross-reference.md");
  for (const source of sources) {
    expect(reference).toContain(`](../${source}#021-2026-10-16)`);
    const release = read(source).split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
    const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
    const entries = fixes?.split("\n").filter((line) => line.startsWith(title));
    expect(entries, source).toHaveLength(1);
    expect(fixes?.trimStart().startsWith(title), source).toBe(true);
    const entry = entries?.[0] ?? "";
    for (const behavior of [
      "The wiring step never writes to the vault or fills in missing values.",
      "Provider setup may already store real values",
      "reports providers as skipped instead of identifying missing names",
      "every call failed",
    ]) {
      expect(entry, source).toContain(behavior);
    }
  }
  expect(reference).toContain("stopped attempting to\nwrite placeholder secrets");
  expect(reference).toContain("checks existing secret names without\nfilling missing values");
});
