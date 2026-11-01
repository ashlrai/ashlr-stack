import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/changelog-apply-reader-questions.md");
const doc = readFileSync(docPath, "utf8");
// Prose wraps mid-phrase; collapse whitespace before matching claims.
const flat = doc.replace(/\s+/g, " ");
const copies = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const release = "0.2.1 (2026-10-16)";
const heading = "- **`stack apply` stops attempting to write placeholder secrets.**";

function releaseSection(changelog: string): string {
  const section = changelog.split(`## ${release}\n`)[1]?.split("\n## ")[0];
  expect(section, "0.2.1 release section").toBeDefined();
  return section ?? "";
}

test("the questions identify the same apply fix entry in each source", () => {
  for (const path of copies) {
    expect(doc).toContain(`](../${path}#021-2026-10-16)`);
    const changelog = readFileSync(join(root, path), "utf8");
    const section = releaseSection(changelog);

    // The fix is the first bullet of the first Bug fixes in 0.2.1; the
    // doc's warning about a second Bug fixes heading is real.
    const fixes = section.split("### Bug fixes\n");
    expect(fixes.length, path).toBeGreaterThanOrEqual(3);
    expect(section, path).toContain("### Earlier 0.2.1 notes (2026-10-12)");
    expect(fixes[1]?.trimStart().startsWith(heading), path).toBe(true);

    const entries = changelog.split("\n").filter((line) => line.startsWith(heading));
    expect(entries, path).toHaveLength(1);
  }
  expect(doc).toContain("**`stack apply` stops attempting to write placeholder secrets.**");
});

test("the differences answer matches the checked-in sources", () => {
  const changelogs = copies.map((path) => readFileSync(join(root, path), "utf8"));
  expect(changelogs[0]).toBe(changelogs[1]);

  const differences = doc.split("## What are the differences")[1]?.split("\n## ")[0];
  expect(differences).toBeDefined();
  expect(differences).toContain("byte-for-byte identical");
  expect(differences).toContain("sync-content");
  expect(differences).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  expect(doc).toContain("`/docs/changelog`");
  for (const path of copies) {
    expect(differences).toContain(`\`${path}\``);
  }
});

test("the entry details the doc answers with come from both sources", () => {
  for (const path of copies) {
    const entry = readFileSync(join(root, path), "utf8")
      .split("\n")
      .find((line) => line.startsWith(heading));
    expect(entry, path).toBeDefined();
    for (const claim of [
      "never writes to the vault or fills in missing values",
      "phantom list --json",
      "secrets in vault N · missing M · webhooks K",
      "not in Phantom:",
      "skipped instead of identifying missing names",
      "phantom add <KEY> TODO_STACK_APPLY --rotate",
      "envelopes` count was always 0",
      "`WireResult.envelopes` is replaced by `present` and `missing`",
    ]) {
      expect(entry, `${path}: ${claim}`).toContain(claim);
      expect(flat, `doc: ${claim}`).toContain(claim);
    }
  }
});

test("every restated entry the doc names exists verbatim in both sources", () => {
  for (const path of copies) {
    const changelog = readFileSync(join(root, path), "utf8");
    for (const firstLine of [
      "- `stack apply` does not create placeholder secrets. After at least one provider succeeds, wiring checks secret names for every provider in the recipe, including providers that failed",
      "- Apply wiring checks existing secret names without storing placeholders; unreadable vaults are reported as skipped, not missing.",
      "- After at least one provider succeeds, `stack apply` wiring checks the recipe's secret names without creating placeholders or filling missing values.",
      "- **`stack apply` with a missing recipe writes nothing.**",
      "- **`stack apply` and `stack init --template` keep going after a provider fails.**",
      "- **`stack apply [recipe-id]`**",
    ]) {
      const found = changelog.split("\n").some((line) => line.startsWith(firstLine));
      expect(found, `${path}: ${firstLine}`).toBe(true);
    }
  }
  expect(doc).toContain("](site-changelog-source-map.md)");
});

test("linked files exist and the verification commands name real paths", () => {
  for (const match of doc.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    expect(existsSync(join(dirname(docPath), match[1])), `broken link: ${match[1]}`).toBe(true);
  }
  expect(doc).toContain("grep -n -F 'stops attempting to write placeholder secrets.'");
  expect(doc).toContain("bun test packages/site/tests/changelog.test.ts");
  expect(existsSync(join(root, "packages/site/tests/changelog.test.ts"))).toBe(true);
});
