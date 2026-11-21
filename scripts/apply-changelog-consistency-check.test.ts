import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("apply comparison identifies entries in matching checked-in changelogs", () => {
  const source = read("CHANGELOG.md");
  const site = read("packages/site/src/data/CHANGELOG.md");
  const report = read("docs/apply-changelog-consistency-check.md");
  expect(site).toBe(source);
  expect(report).toContain("match byte for byte");
  expect(report).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");

  for (const [release, markers] of [
    ["Unreleased", ["`stack apply` does not create placeholder secrets"]],
    ["0.3.0 (2026-10-31)", ["Apply wiring checks existing secret names", "After at least one provider succeeds, `stack apply`", "phantom-wire skipped: openai"]],
    ["0.2.2 (2026-10-25)", ["`stack apply` with a missing recipe writes nothing", "`stack apply` and `stack init --template` keep going"]],
    ["0.2.1 (2026-10-16)", ["`stack apply` stops attempting to write placeholder secrets"]],
    ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", ["`stack apply [recipe-id]`", "`stack_apply` exposed"]],
  ] as const) {
    const section = source.split(`## ${release}\n`)[1]?.split("\n## ")[0];
    expect(section).toBeDefined();
    for (const marker of markers) expect(section).toContain(marker);
    expect(report).toContain(release === "Unreleased" ? release : release.split(" ")[0]);
  }
});

const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const title = "- **`stack apply` stops attempting to write placeholder secrets.**";

test("cross-reference section links to both copies of the placeholder wiring fix", () => {
  const report = read("docs/apply-changelog-consistency-check.md");
  const reference = report.split("## Where the 0.2.1 fix appears\n")[1];
  expect(reference).toBeDefined();
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
