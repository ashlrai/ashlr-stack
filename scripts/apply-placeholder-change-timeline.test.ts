import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-placeholder-change-timeline.md");
const doc = readFileSync(docPath, "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

function section(heading: string): string {
  const start = changelog.indexOf(`\n## ${heading}\n`);
  expect(start, `missing release: ${heading}`).toBeGreaterThanOrEqual(0);
  return changelog.slice(start + 1).split(/\n## /)[0];
}

test("timeline identifies the recorded fix and its release context", () => {
  const fix = section("0.2.1 (2026-10-16)");
  expect(fix).toContain("**`stack apply` stops attempting to write placeholder secrets.**");
  expect(fix).toContain("every call failed");
  expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");
  expect(section("0.2.2 (2026-10-25)")).toContain("its npm publish failed");
  expect(section("0.3.0 (2026-10-31)")).toContain("unreadable vaults are reported as skipped");
  expect(section("Unreleased")).toContain("including providers that failed");

  for (const entry of ["0.1.0", "0.2.1", "0.2.2", "0.3.0", "Unreleased"]) {
    expect(doc).toContain(entry);
  }
  expect(doc).toContain("**`stack apply` stops attempting to write placeholder secrets.**");
  expect(doc).toContain("0.2.1 was tagged but its npm publish failed");
});

test("timeline distinguishes failed historical writes from current name checks", () => {
  const normalized = doc.replace(/\s+/g, " ");
  for (const claim of [
    "every call failed and the printed `envelopes` count was always zero",
    "does not write to the vault or fill in missing values",
    "Provider setup is separate and may store real credentials",
    "an unreadable vault yields skipped providers",
    "A missing name alone does not fail apply, while provider failures do",
    "`--noWire` skips both name checks and stubs",
    "If no provider succeeds, apply does not attempt wiring",
  ]) {
    expect(normalized).toContain(claim);
  }
});

test("timeline links to existing local sources and changelog headings", () => {
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const [target, fragment] = match[1].split("#");
    const path = resolve(dirname(docPath), target);
    expect(existsSync(path), `broken link: ${match[1]}`).toBe(true);
    if (fragment && path === join(root, "CHANGELOG.md")) {
      const headings = [...changelog.matchAll(/^#+ (.+)$/gm)].map((heading) =>
        heading[1].toLowerCase().replace(/[^\w\s-]/g, "").replace(/ /g, "-"),
      );
      expect(headings).toContain(fragment);
    }
  }
});
