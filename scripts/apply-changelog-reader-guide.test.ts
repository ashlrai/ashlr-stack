import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-changelog-reader-guide.md");
const doc = readFileSync(docPath, "utf8");
const flat = doc.replace(/\s+/g, " ");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const read = (path: string) => readFileSync(join(root, path), "utf8");
const section = (changelog: string, heading: string) =>
  changelog.split(`## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";

test("the guide links both changelogs and each cited entry exists in both", () => {
  const locations: [string, string, string][] = [
    ["Unreleased", "unreleased", "- `stack apply` does not create placeholder secrets."],
    ["0.3.0 (2026-10-31)", "030-2026-10-31", "- Apply wiring checks existing secret names"],
    ["0.2.2 (2026-10-25)", "022-2026-10-25", "- **`stack apply` with a missing recipe writes nothing.**"],
    [
      "0.2.1 (2026-10-16)",
      "021-2026-10-16",
      "- **`stack apply` stops attempting to write placeholder secrets.**",
    ],
    [
      "0.1.0 — 2026-04-19 (superseded by 0.1.1)",
      "010--2026-04-19-superseded-by-011",
      "- **`stack apply [recipe-id]`**",
    ],
  ];
  for (const [release, fragment, entry] of locations) {
    for (const path of sources) {
      expect(doc, `${release} ${path}`).toContain(`](../${path}#${fragment})`);
      expect(section(read(path), release), `${path}: ${release}`).toContain(entry);
    }
  }
});

test("the changelogs are identical and the guide's claims match the entries", () => {
  const [repository, site] = sources.map(read);
  expect(repository).toBe(site);
  expect(flat).toContain("byte-for-byte identical");
  const unreleased = section(repository, "Unreleased");
  for (const claim of [
    "a missing name does not itself fail apply, while provider failures do",
    "even if the vault is unreadable",
    "`--noWire` skips both checks and stubs",
  ]) {
    expect(unreleased, `entry: ${claim}`).toContain(claim);
    expect(flat, `doc: ${claim}`).toContain(claim);
  }
  expect(flat).toContain("phantom add <NAME>");
  expect(section(repository, "0.2.1 (2026-10-16)")).toContain("### Earlier 0.2.1 notes (2026-10-12)");
});

test("links resolve and the verify commands name real paths", () => {
  for (const match of doc.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    expect(existsSync(join(dirname(docPath), match[1])), `broken link: ${match[1]}`).toBe(true);
  }
  expect(doc).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  expect(existsSync(join(root, "packages/site/tests/changelog.test.ts"))).toBe(true);
});
