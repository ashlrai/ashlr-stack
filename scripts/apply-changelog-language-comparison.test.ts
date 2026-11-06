import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

// The report describes the checked-in copies. A site build can overwrite a
// discrepancy, so compare them directly instead of invoking sync-content.
test("language comparison is grounded in both checked-in changelogs", () => {
  const source = read("CHANGELOG.md");
  const site = read("packages/site/src/data/CHANGELOG.md");
  const report = read("docs/apply-changelog-language-comparison.md");
  expect(site).toBe(source);
  expect(report).toContain("no wording or substantive differences between the two copies");
  expect(report).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  for (const path of ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"]) {
    expect(report).toContain(`](../${path})`);
  }

  for (const [heading, markers] of [
    ["Unreleased", ["including providers that failed", "`--noWire` skips both checks and stubs"]],
    ["0.3.0 (2026-10-31)", ["Provider setup may still persist real credentials", "they do not establish that the vault is empty"]],
    ["0.2.1 (2026-10-16)", ["every call failed", "`WireResult.envelopes` is replaced by `present` and `missing`"]],
    ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", ["Missing names alone do not make apply fail", "creates webhook stubs"]],
  ] as const) {
    const section = source.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
    expect(section).toBeDefined();
    for (const marker of markers) expect(section).toContain(marker);
    expect(report).toContain(heading.split(" ")[0]);
  }
});
