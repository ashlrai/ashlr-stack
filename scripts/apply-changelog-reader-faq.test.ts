import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-changelog-reader-faq.md");
const doc = readFileSync(docPath, "utf8");
// Prose wraps mid-phrase; collapse whitespace before matching claims.
const flat = doc.replace(/\s+/g, " ");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const heading = "- **`stack apply` stops attempting to write placeholder secrets.**";

const read = (path: string) => readFileSync(join(root, path), "utf8");
const section = (changelog: string, heading_: string) =>
  changelog.split(`## ${heading_}\n`)[1]?.split("\n## ")[0] ?? "";

test("every location the FAQ names holds the entry it cites in both changelogs", () => {
  const locations: [string, string, string][] = [
    [
      "Unreleased",
      "unreleased",
      "- `stack apply` does not create placeholder secrets.",
    ],
    [
      "0.3.0 (2026-10-31)",
      "030-2026-10-31",
      "- Apply wiring checks existing secret names without storing placeholders",
    ],
    [
      "0.2.2 (2026-10-25)",
      "022-2026-10-25",
      "- **`stack apply` with a missing recipe writes nothing.**",
    ],
    ["0.2.1 (2026-10-16)", "021-2026-10-16", heading],
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

test("the fix is where the FAQ says it is: first bullet of 0.2.1's first Bug fixes", () => {
  for (const path of sources) {
    const release = section(read(path), "0.2.1 (2026-10-16)");
    // The release has a second Bug fixes heading under the earlier notes.
    expect(release, path).toContain("### Earlier 0.2.1 notes (2026-10-12)");
    expect(release.split("### Bug fixes\n").length, path).toBeGreaterThanOrEqual(3);
    expect(release.split("### Bug fixes\n")[1]?.trimStart().startsWith(heading), path).toBe(
      true,
    );
    expect(
      release.split("\n").filter((line) => line.startsWith(heading)),
      path,
    ).toHaveLength(1);
  }
  expect(flat).toContain("first bullet under the first **Bug fixes** heading");
  expect(flat).toContain("second **Bug fixes** heading");
});

test("the what-changed answer only repeats claims the entry makes", () => {
  const [repository, site] = sources.map(read);
  expect(repository).toBe(site);
  const entry = repository.split("\n").find((line) => line.startsWith(heading));
  expect(entry).toBeDefined();
  for (const claim of [
    "never writes to the vault or fills in missing values",
    "phantom add <KEY> TODO_STACK_APPLY --rotate",
    "has no `--rotate`",
    "envelopes` count was always 0",
    "`WireResult.envelopes` is replaced by `present` and `missing`",
    "phantom add <NAME>` from a trusted terminal",
  ]) {
    expect(entry, `entry: ${claim}`).toContain(claim);
    expect(flat, `doc: ${claim}`).toContain(claim);
  }
});

test("the FAQ stays within what the changelogs support", () => {
  // Every limit the FAQ names is stated in a recorded entry.
  const unreleased = section(read(sources[0]), "Unreleased");
  for (const claim of [
    "a missing name does not itself fail apply, while provider failures do",
    "even if the vault is unreadable",
    "`--noWire` skips both checks and stubs",
  ]) {
    expect(unreleased, `entry: ${claim}`).toContain(claim);
    expect(flat, `doc: ${claim}`).toContain(claim);
  }
  const release030 = section(read(sources[0]), "0.3.0 (2026-10-31)");
  expect(release030).toContain("they do not establish that the vault is empty");
  expect(flat).toContain("do not show the vault is empty or complete");
  // The doc disclaims operational reach rather than asserting it.
  for (const caveat of [
    "not an installed version or a deployed site",
    "do not record which version is installed or deployed",
    "first shipped in 0.2.2",
    "byte-for-byte identical",
    "sync-content",
  ]) {
    expect(flat, `doc: ${caveat}`).toContain(caveat);
  }
});

test("links resolve and the verification commands name real paths", () => {
  for (const match of doc.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    expect(existsSync(join(dirname(docPath), match[1])), `broken link: ${match[1]}`).toBe(
      true,
    );
  }
  expect(doc).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  expect(doc).toContain("bun test packages/site/tests/changelog.test.ts");
  expect(existsSync(join(root, "packages/site/tests/changelog.test.ts"))).toBe(true);
});
