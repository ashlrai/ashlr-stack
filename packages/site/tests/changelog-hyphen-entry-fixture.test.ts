import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

// The "Handshake conformance kit" entry excerpted from CHANGELOG.md, release 0.2.2 / Added.
// Its text has internal hyphens in "machine-readable" and "dependency-free".
const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-hyphen-entry.md"), "utf8");
const root = readFileSync(join(import.meta.dir, "../../../CHANGELOG.md"), "utf8");
const published = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

const FULL_TEXT =
  "Handshake conformance kit: `contract/ashlr-handshake.v1.json` is the canonical machine-readable `--ashlr-handshake` v1 contract (pinned by sha256), with a dependency-free checker (`lib/handshake-conformance.ts`) and gated capabilities that map to the argv other tools run (`doctor-fix` means `doctor --fix --json`). Stack's test validates its own handshake and that `stack doctor --ecosystem --fix` uses the contract argv. Other tools vendor the file and run the same check. Docs: docs/ashlr-handshake.md.";

function entries(markdown: string): Tokens.ListItem[] {
  return marked
    .lexer(markdown)
    .filter((t): t is Tokens.List => t.type === "list")
    .flatMap((list) => list.items);
}

test("the parsed entry keeps its internal hyphens and its full text", () => {
  const found = entries(fixture);
  expect(found).toHaveLength(1);
  expect(found[0].text).toBe(FULL_TEXT);
  expect(found[0].text).toContain("machine-readable");
  expect(found[0].text).toContain("dependency-free");
});

test("hyphens inside the entry do not split it or add headings", () => {
  const tokens = marked.lexer(fixture);
  expect(tokens.filter((t) => t.type === "heading").map((t) => (t as Tokens.Heading).text)).toEqual([
    "Changelog",
    "0.2.2 (2026-10-25)",
    "Added",
  ]);
  expect(entries(fixture)).toHaveLength(1);
});

test("the rendered entry keeps the hyphens, including inside inline code", async () => {
  const html = await marked.parse(fixture);
  expect(html).toContain("canonical machine-readable <code>--ashlr-handshake</code> v1 contract");
  expect(html).toContain("a dependency-free checker");
  expect(html).toContain("<code>doctor --fix --json</code>");
});

test("the fixture entry is still present verbatim in both changelogs", () => {
  const raw = entries(fixture)[0].raw.trim();
  expect(entries(root).map((e) => e.raw.trim())).toContain(raw);
  expect(entries(published).map((e) => e.raw.trim())).toContain(raw);
});
