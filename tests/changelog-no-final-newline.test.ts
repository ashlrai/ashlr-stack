import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const fixture = readFileSync(new URL("./__fixtures__/changelog-no-final-newline.md", import.meta.url), "utf8");

/** Body of each semver `##` section, keyed by heading line (fenced code ignored). */
function versionBodies(md: string): Map<string, string> {
  const bodies = new Map<string, string>();
  let key: string | null = null;
  let fenced = false;
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^##(?!#)/.test(line)) {
      key = /^## +\[?\d+\.\d+\.\d+/.test(line) ? line : null;
      if (key) bodies.set(key, "");
    } else if (key) {
      bodies.set(key, `${bodies.get(key)}${line}\n`);
    }
  }
  return bodies;
}

test("fixture really ends without a newline", () => {
  expect(fixture.endsWith("\n")).toBe(false);
  expect(fixture.endsWith("no newline.")).toBe(true);
});

test("final version and its last entry are retained", () => {
  const bodies = versionBodies(fixture);
  expect([...bodies.keys()]).toEqual(["## 0.2.0 (2026-05-01)", "## 0.1.0 (2026-04-19)"]);
  const last = bodies.get("## 0.1.0 (2026-04-19)") ?? "";
  expect(last).toContain("- First version entry, final line has no newline.");
  expect(last.trimEnd().endsWith("no newline.")).toBe(true);
});

test("earlier version is not polluted by the final one", () => {
  expect(versionBodies(fixture).get("## 0.2.0 (2026-05-01)")).toBe("\n### Added\n\n- Second version entry.\n\n");
});

test("every level-2 heading in the unterminated fixture is a release heading", () => {
  const headings = fixture.split("\n").filter((l) => /^##(?!#)/.test(l));
  expect(headings).toEqual(["## Unreleased", "## 0.2.0 (2026-05-01)", "## 0.1.0 (2026-04-19)"]);
});
