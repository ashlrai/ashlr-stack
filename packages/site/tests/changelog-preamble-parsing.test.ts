import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked, type Tokens } from "marked";

const root = join(import.meta.dir, "../../..");

/** A `##` heading that opens with a semver (either bare or bracketed). */
function isVersionHeading(token: Tokens.Generic): boolean {
  return (
    token.type === "heading" &&
    token.depth === 2 &&
    /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/.test(token.text ?? "")
  );
}

/**
 * Split a changelog into the preamble (all tokens before the first version
 * heading) and the version headings (all `##` headings that match the semver
 * grammar). The preamble carries the raw token list so callers can inspect
 * structure; the versions are the version-heading tokens in file order.
 */
function parsePreambleAndVersions(markdown: string): {
  preamble: Tokens.List;
  versions: Tokens.Heading[];
} {
  const tokens = marked.lexer(markdown);
  const firstVersionIndex = tokens.findIndex(isVersionHeading);

  if (firstVersionIndex === -1) {
    // No version headings — entire document is preamble, no versions.
    return { preamble: tokens, versions: [] };
  }

  return {
    preamble: tokens.slice(0, firstVersionIndex),
    versions: tokens.filter((t): t is Tokens.Heading => isVersionHeading(t)),
  };
}

// — Real-site tests against the published changelog —

test("site changelog preamble does not leak into versions", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const { preamble, versions } = parsePreambleAndVersions(published);

  // The preamble carries tokens (title, Unreleased, etc.).
  expect(preamble.length).toBeGreaterThan(0);

  // The first version is the first semver `##` heading.
  expect(versions.length).toBeGreaterThan(0);

  // No preamble token is a version heading — a sanity check on the split.
  expect(preamble.some((t) => isVersionHeading(t as Tokens.Generic))).toBe(false);
});

test("site changelog first version remains intact after preamble split", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const { versions } = parsePreambleAndVersions(published);

  // The first version is "0.3.3 (2026-11-06)" — verify it is not mangled.
  expect(versions[0].text).toBe("0.3.3 (2026-11-06)");
  expect(versions[0].depth).toBe(2);
});

// — Fixture tests (synthetic documents) —

test("prose before the first version stays in the preamble, not in versions", () => {
  const markdown = [
    "# Changelog",
    "",
    "This is introductory prose that explains the changelog.",
    "",
    "## Unreleased",
    "",
    "### Added",
    "",
    "- something new",
    "",
    "## 0.1.0 (2026-01-01)",
    "",
    "- initial release",
    "",
  ].join("\n");

  const { preamble, versions } = parsePreambleAndVersions(markdown);

  // The preamble has tokens (the title, prose, Unreleased section).
  expect(preamble.length).toBeGreaterThan(0);

  // The prose text is in the preamble.
  const proseInPreamble = preamble.find(
    (t) => t.type === "paragraph" && t.text?.includes("introductory prose"),
  );
  expect(proseInPreamble).toBeDefined();

  // Exactly one version: 0.1.0.
  expect(versions).toHaveLength(1);
  expect(versions[0].text).toBe("0.1.0 (2026-01-01)");
});

test("## Unreleased in the preamble is never returned as a version", () => {
  const markdown = [
    "# Changelog",
    "",
    "## Unreleased",
    "",
    "- work in progress",
    "",
    "## 0.2.0 (2026-06-15)",
    "",
    "## 0.1.0 (2026-01-01)",
    "",
  ].join("\n");

  const { preamble, versions } = parsePreambleAndVersions(markdown);

  // Unreleased is part of the preamble.
  const unreleasedInPreamble = preamble.find(
    (t) => t.type === "heading" && t.text === "Unreleased",
  );
  expect(unreleasedInPreamble).toBeDefined();

  // It does NOT appear in the versions list.
  expect(versions.map((v) => v.text)).not.toContain("Unreleased");

  // Two versions, starting with 0.2.0.
  expect(versions.map((v) => v.text)).toEqual([
    "0.2.0 (2026-06-15)",
    "0.1.0 (2026-01-01)",
  ]);
});

test("document with no versions returns the entire doc as preamble", () => {
  const markdown = [
    "# Changelog",
    "",
    "No releases yet.",
    "",
  ].join("\n");

  const { preamble, versions } = parsePreambleAndVersions(markdown);
  expect(versions).toEqual([]);

  // The preamble contains the title and the paragraph.
  expect(preamble.find((t) => t.type === "heading" && t.text === "Changelog")).toBeDefined();
  expect(preamble.find((t) => t.type === "paragraph" && t.text?.includes("No releases"))).toBeDefined();
});

test("versions immediately after the title (no preamble prose) still split", () => {
  const markdown = [
    "# Changelog",
    "",
    "## 1.0.0 (2026-11-01)",
    "",
    "- released today",
    "",
  ].join("\n");

  const { preamble, versions } = parsePreambleAndVersions(markdown);

  // Preamble has the title (and maybe whitespace).
  expect(preamble.find((t) => t.type === "heading" && t.text === "Changelog")).toBeDefined();

  // First version is 1.0.0.
  expect(versions[0].text).toBe("1.0.0 (2026-11-01)");
  expect(versions).toHaveLength(1);
});

test("multiple preamble sections do not pollute version extraction", () => {
  const markdown = [
    "# Changelog",
    "",
    "Welcome to the changelog.",
    "",
    "## Unreleased",
    "",
    "### Breaking changes",
    "",
    "- API v2 is out",
    "",
    "### Added",
    "",
    "- new endpoint",
    "",
    "## 2.0.0 (2026-09-01)",
    "",
    "- v2 release",
    "",
    "## 1.0.0 (2026-01-15)",
    "",
    "- initial release",
    "",
  ].join("\n");

  const { preamble, versions } = parsePreambleAndVersions(markdown);

  // Preamble contains the Unreleased heading and its subsections.
  expect(preamble.find((t) => t.type === "heading" && t.text === "Unreleased")).toBeDefined();
  expect(preamble.find((t) => t.type === "heading" && t.text === "Breaking changes")).toBeDefined();

  // Only real versions in the versions list.
  expect(versions.map((v) => v.text)).toEqual([
    "2.0.0 (2026-09-01)",
    "1.0.0 (2026-01-15)",
  ]);
});

test("bracketed version headings are also split correctly", () => {
  const markdown = [
    "# Changelog",
    "",
    "Some intro text.",
    "",
    "## [0.5.0] — 2026-08-01",
    "",
    "- release",
    "",
    "## [0.4.0] — 2026-07-01",
    "",
    "- earlier",
    "",
  ].join("\n");

  const { preamble, versions } = parsePreambleAndVersions(markdown);

  // Intro is in preamble.
  expect(preamble.find((t) => t.type === "paragraph" && t.text?.includes("intro text"))).toBeDefined();

  // Bracketed styles are captured.
  expect(versions.map((v) => v.text)).toEqual([
    "[0.5.0] — 2026-08-01",
    "[0.4.0] — 2026-07-01",
  ]);
});

test("empty document returns empty preamble and no versions", () => {
  const { preamble, versions } = parsePreambleAndVersions("");
  expect(preamble).toEqual([]);
  expect(versions).toEqual([]);
});
