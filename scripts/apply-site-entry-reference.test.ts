import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const site = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
const reference = readFileSync(join(root, "docs/apply-site-entry-reference.md"), "utf8");

function section(release: string, heading: string): string {
  return (
    site.split(`## ${release}\n`)[1]?.split("\n## ")[0]?.split(`### ${heading}\n`)[1]?.split("\n### ")[0] ??
    ""
  );
}

test("reference identifies the original site entry and its behavior", () => {
  const fixes = section("0.2.1 (2026-10-16)", "Bug fixes");
  const title = "**`stack apply` stops attempting to write placeholder secrets.**";
  expect(fixes.trimStart().startsWith(`- ${title}`)).toBe(true);
  expect(reference).toContain("../packages/site/src/data/CHANGELOG.md#021-2026-10-16");
  expect(reference).toContain("0.2.1 (2026-10-16) → Bug fixes");
  expect(reference).toContain(title);
  for (const [source, summary] of [
    ["never writes to the vault or fills in missing values", "no longer writes to the vault or fills missing values"],
    ["Provider setup may already store real values", "Provider setup may separately store real values"],
    ["reports providers as skipped instead of identifying missing names", "reports providers as skipped instead of identifying missing names"],
    ["`WireResult.envelopes` is replaced by `present` and `missing`", "`WireResult.envelopes` was replaced by"],
  ]) {
    expect(fixes).toContain(source);
    expect(reference).toContain(summary);
  }
});

test("later site note supports the separate operational clarification", () => {
  const later = section("Unreleased", "Changed");
  for (const phrase of [
    "at least one provider succeeds",
    "including providers that failed",
    "even if the vault is unreadable",
    "`--noWire` skips both checks and stubs",
  ]) {
    expect(later).toContain(phrase);
  }
  expect(reference).toContain("These are later clarifications");
  expect(reference).toContain("Missing names alone do not fail apply, while provider failures do.");
  expect(reference).toContain("`--noWire` skips both");
});
