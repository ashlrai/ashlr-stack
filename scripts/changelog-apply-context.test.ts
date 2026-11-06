import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/changelog-apply-context.md");
const doc = readFileSync(docPath, "utf8");
const copies = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"] as const;
const changelogs = copies.map((path) => readFileSync(join(root, path), "utf8"));

const FIX_HEADING = "## 0.2.1 (2026-10-16)";
const FIX_ANCHOR = "021-2026-10-16";
const FIX_ENTRY = "- **`stack apply` stops attempting to write placeholder secrets.**";
const ORIG_HEADING = "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)";
const ORIG_ANCHOR = "010--2026-04-19-superseded-by-011";
const ORIG_ENTRY = "- **`stack apply [recipe-id]`**";

// The text of one `## ` release section, heading included.
function releaseSection(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  expect(start, `missing heading: ${heading}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const end = rest.slice(heading.length).search(/^## /m);
  return end === -1 ? rest : rest.slice(0, heading.length + end);
}

// GitHub-style heading slugs: lowercase, drop punctuation except word
// characters, spaces, hyphens and underscores, then each space becomes a
// hyphen (a dropped em-dash leaves two spaces, hence a double hyphen).
function headingAnchors(text: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of text.split("\n")) {
    const heading = line.match(/^#{1,6} +(.*?)\s*$/);
    if (!heading) continue;
    anchors.add(
      heading[1]
        .toLowerCase()
        .replace(/[^\p{L}\p{N} _-]/gu, "")
        .replace(/\s/g, "-"),
    );
  }
  return anchors;
}

function placeholderEntries(changelog: string): [string, string] {
  const fix = releaseSection(changelog, FIX_HEADING)
    .split("\n")
    .filter((line) => line.startsWith(FIX_ENTRY));
  const original = releaseSection(changelog, ORIG_HEADING)
    .split("\n")
    .filter((line) => line.startsWith(ORIG_ENTRY));
  expect(fix).toHaveLength(1);
  expect(original).toHaveLength(1);
  return [fix[0], original[0]];
}

test("doc explains that the placeholder behavior is historical", () => {
  const flat = doc.replace(/\s+/g, " ");
  for (const claim of [
    "That behavior is historical",
    "every call failed",
    "they do not happen today",
    "do not run them",
    "`TODO_STACK_APPLY`",
    "`phantom add <KEY> TODO_STACK_APPLY --rotate`",
    "`WireResult.envelopes`",
    "`present` and `missing`",
    "`phantom list --json`",
    "`phantom add <NAME>`",
    "`--noWire`",
  ]) {
    expect(flat).toContain(claim);
  }
});

test("doc points readers to both entries in both changelog copies", () => {
  for (const anchor of [FIX_ANCHOR, ORIG_ANCHOR]) {
    for (const path of copies) {
      expect(doc).toContain(`](../${path}#${anchor})`);
    }
  }
  const flat = doc.replace(/\s+/g, " ");
  for (const title of [
    FIX_ENTRY.slice(2), // drop the "- " list marker
    "`stack apply [recipe-id]`",
  ]) {
    expect(flat).toContain(title);
  }
});

test("both changelogs record the same two placeholder entries", () => {
  const [rootFix, rootOriginal] = placeholderEntries(changelogs[0]);
  const [siteFix, siteOriginal] = placeholderEntries(changelogs[1]);
  expect(siteFix).toBe(rootFix);
  expect(siteOriginal).toBe(rootOriginal);
  expect(changelogs[1]).toBe(changelogs[0]);

  for (const entry of [rootFix, rootOriginal]) {
    expect(entry).toContain("TODO_STACK_APPLY");
    expect(entry).toContain("failed");
  }
  expect(rootFix).toContain("The wiring step never writes to the vault or fills in missing values.");
  expect(rootOriginal).toContain("Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder");

  // Losing either entry in either copy must break detection.
  for (const index of [0, 1] as const) {
    for (const entry of [FIX_ENTRY, ORIG_ENTRY]) {
      const changed = [...changelogs] as [string, string];
      changed[index] = changed[index].replace(entry, "- **mutated entry.**");
      const other = changelogs[index === 0 ? 1 : 0];
      expect(() => placeholderEntries(changed[index])).toThrow();
      expect(() => placeholderEntries(other)).not.toThrow();
    }
  }
});

test("every changelog anchor cited in the doc exists in both changelogs", () => {
  const anchors = [...doc.matchAll(/\]\(\.\.\/([^)#\s]+)#([^)\s]+)\)/g)];
  expect(anchors.length).toBeGreaterThanOrEqual(4);
  for (const [, path, anchor] of anchors) {
    const target = copies.findIndex((copy) => copy === path);
    expect(target, `link to non-changelog path: ${path}`).toBeGreaterThanOrEqual(0);
    expect(headingAnchors(changelogs[target]), `missing anchor ${anchor} in ${path}`).toContain(anchor);
  }
});

test("every relative link in the doc resolves to a file", () => {
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target === "" || /^[a-z]+:/.test(target)) continue;
    expect(existsSync(resolve(dirname(docPath), target)), `broken link: ${match[1]}`).toBe(true);
  }
});
