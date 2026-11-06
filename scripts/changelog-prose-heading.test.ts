import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Release = { heading: string; body: string };

// A release starts at a `## ` heading naming a version (bare or bracketed) or
// "Unreleased". Any other heading, even a `## ` one, is prose inside the
// current release and must stay in its body. Fenced code is never a heading.
const releaseHeading = /^## (?:\[?\d+\.\d+\.\d+\]?(?:\s|$)|Unreleased\s*$)/;

function releases(markdown: string): Release[] {
  const found: Release[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    }
    if (fence === null && !marker && releaseHeading.test(line)) {
      found.push({ heading: line.slice(3).trim(), body: "" });
    } else if (found.length > 0) {
      found[found.length - 1].body += `${line}\n`;
    }
  }
  return found;
}

// Prose that looks like a heading: a non-version `##` heading, a `###` heading,
// a setext heading, and a `## 1.2` style line that is not a full version.
const fixture = [
  "# Changelog",
  "",
  "## Unreleased",
  "",
  "- Pending work.",
  "",
  "## 0.3.0 (2026-10-31)",
  "",
  "### Added",
  "",
  "- A feature.",
  "",
  "## Upgrade notes",
  "",
  "Run `stack doctor` after upgrading.",
  "",
  "Migration",
  "---------",
  "",
  "## 1.2 roadmap",
  "",
  "```md",
  "## 9.9.9 (not a release, it is inside a fence)",
  "```",
  "",
  "## [0.2.1] — 2026-10-16",
  "",
  "- A fix.",
  "",
].join("\n");

test("a non-version heading stays in the body of the version it follows", () => {
  const found = releases(fixture);
  expect(found.map((release) => release.heading)).toEqual([
    "Unreleased",
    "0.3.0 (2026-10-31)",
    "[0.2.1] — 2026-10-16",
  ]);

  const body = found[1].body;
  expect(body).toContain("### Added");
  expect(body).toContain("## Upgrade notes");
  expect(body).toContain("Run `stack doctor` after upgrading.");
  expect(body).toContain("Migration\n---------");
  expect(body).toContain("## 1.2 roadmap");
  expect(body).toContain("## 9.9.9 (not a release, it is inside a fence)");
});

test("heading-like prose does not leak into neighbouring releases", () => {
  const [unreleased, , previous] = releases(fixture);
  for (const body of [unreleased.body, previous.body]) {
    expect(body).not.toContain("Upgrade notes");
    expect(body).not.toContain("roadmap");
  }
  expect(previous.body.trim()).toBe("- A fix.");
});

test("release parsing is lossless: bodies and headings rebuild the file", () => {
  const found = releases(fixture);
  const preamble = fixture.slice(0, fixture.indexOf("## Unreleased"));
  const rebuilt = preamble + found.map((release) => `## ${release.heading}\n${release.body}`).join("");
  expect(rebuilt.trimEnd()).toBe(fixture.trimEnd());
});

test.each(["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"])("%s parses into non-empty releases", (path) => {
  const found = releases(readFileSync(join(import.meta.dir, "..", path), "utf8"));
  expect(found[0]?.heading).toBe("Unreleased");
  expect(found.length).toBeGreaterThan(1);
  for (const release of found) expect(release.body.trim(), release.heading).not.toBe("");
});
