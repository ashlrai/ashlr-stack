import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const docPath = resolve(import.meta.dir, "../docs/apply-upgrade-note.md");
const doc = readFileSync(docPath, "utf8");
const text = doc.replace(/\s+/g, " ");
const changelog = readFileSync(resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");
const section = (heading: string) =>
  changelog.split(`## ${heading}`)[1]?.split("\n## ")[0] ?? "";

test("the note recounts the former placeholder behavior exactly as the changelog records it", () => {
  const fix = section("0.2.1 (2026-10-16)");
  for (const detail of [
    "`phantom add <KEY> TODO_STACK_APPLY --rotate`",
    "every call failed",
    "`envelopes` count was always 0",
  ]) {
    expect(fix).toContain(detail);
    expect(text).toContain(detail);
  }
  for (const detail of [
    "refuses values in command arguments",
    "no `--rotate` option",
    "no placeholder was ever stored",
    "historical, not instructions to run",
    "nothing from them to clean up",
    "counted failed attempts, not stored secrets",
  ]) {
    expect(text).toContain(detail);
  }
});

test("the note describes current wiring behavior consistent with the changelog", () => {
  const fix = section("0.2.1 (2026-10-16)");
  const current = section("Unreleased");
  expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");
  expect(current).toContain("does not create placeholder secrets");
  expect(current).toContain("including providers that failed");
  expect(current).toContain("a missing name does not itself fail apply");
  for (const detail of [
    "never writes to the vault and does not fill missing values",
    "`phantom list --json`",
    "`WireResult.envelopes` is replaced by `present` and `missing`",
    "including providers that failed",
    "A missing name does not itself fail apply; provider failures do",
    "`skipped` instead of being identified as missing",
    "`phantom add <NAME>` in a trusted terminal",
    "never as a command argument",
    "`--noWire` skips both the secret-name check and the stubs",
    "Provider setup may separately store real credentials",
  ]) {
    expect(text).toContain(detail);
  }
});

test("the note cites real changelog anchors in release order", () => {
  const cited: [string, string][] = [
    ["010--2026-04-19-superseded-by-011", "0.1.0 — 2026-04-19 (superseded by 0.1.1)"],
    ["021-2026-10-16", "0.2.1 (2026-10-16)"],
    ["030-2026-10-31", "0.3.0 (2026-10-31)"],
    ["unreleased", "Unreleased"],
    ["022-2026-10-25", "0.2.2 (2026-10-25)"],
  ];
  for (const [anchor, heading] of cited) {
    expect(doc, `missing citation: ${anchor}`).toContain(`](../CHANGELOG.md#${anchor})`);
    expect(changelog, `missing changelog section for ${anchor}`).toContain(`## ${heading}`);
  }
  // Citations walk the timeline in order through the "Current behavior"
  // section; the 0.2.2 citation closes the note under "Availability".
  let previous = -1;
  for (const [anchor] of cited.slice(0, 4)) {
    const position = doc.indexOf(`](../CHANGELOG.md#${anchor})`);
    expect(position, `out-of-order citation: ${anchor}`).toBeGreaterThan(previous);
    previous = position;
  }
  const release = section("0.2.2 (2026-10-25)");
  expect(release).toContain("0.2.1 was tagged but its npm publish failed");
  expect(text).toContain("0.2.1 was tagged but its npm publish failed");
  expect(text).toContain("first shipped to npm users in 0.2.2");
});

test("the note's relative links resolve and it defers to the installed version", () => {
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target === "" || /^[a-z]+:/.test(target)) continue;
    expect(existsSync(resolve(dirname(docPath), target)), `broken link: ${match[1]}`).toBe(true);
  }
  for (const detail of [
    "stack --version",
    "stack apply --help",
    "Do not assume the behavior of an installed version from the changelog alone",
  ]) {
    expect(text).toContain(detail);
  }
});
