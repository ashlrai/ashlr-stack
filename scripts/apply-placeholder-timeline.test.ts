import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-placeholder-timeline.md");
const doc = readFileSync(docPath, "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

function section(heading: string): string {
  const start = changelog.indexOf(`\n## ${heading}\n`);
  expect(start, `missing changelog section: ${heading}`).toBeGreaterThanOrEqual(0);
  return changelog.slice(start + 1).split(/\n## /)[0];
}

test("timeline follows the changelog's recorded sequence", () => {
  const entries = [
    ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "calls failed; the 0.2.1 fix above removed the attempts"],
    ["0.2.1 (2026-10-16)", "every call failed and the printed `envelopes` count was always 0"],
    ["0.2.2 (2026-10-25)", "its npm publish failed"],
    ["0.3.0 (2026-10-31)", "unreadable vaults are reported as skipped, not missing"],
    ["Unreleased", "including providers that failed"],
  ];
  let previous = -1;
  for (const [heading, evidence] of entries) {
    expect(section(heading)).toContain(evidence);
    const position = doc.indexOf(`](../CHANGELOG.md#${heading === "Unreleased" ? "unreleased" : heading.slice(0, 5).replaceAll(".", "")}`);
    expect(position).toBeGreaterThan(previous);
    previous = position;
  }
  const fix = section("0.2.1 (2026-10-16)");
  expect(fix).toContain("`phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`)");
  expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");
});

test("timeline distinguishes failed writes from current wiring and recovery", () => {
  const flat = doc.replace(/\s+/g, " ");
  for (const claim of [
    "every call failed",
    "do not run them",
    "an unreadable vault yields skipped providers",
    "Provider setup may separately store real credentials",
    "including failed providers",
    "Missing names alone do not fail apply; provider failures do",
    "`--noWire` skips both checks and stubs",
    "`phantom add <NAME>` in a trusted terminal",
  ]) {
    expect(flat).toContain(claim);
  }
});

test("timeline links resolve, including changelog heading fragments", () => {
  const headings = [...changelog.matchAll(/^#+ (.+)$/gm)].map((match) =>
    match[1].toLowerCase().replace(/[^\w\s-]/g, "").replace(/ /g, "-"),
  );
  const links = [...doc.matchAll(/\]\(([^)\s]+)\)/g)];
  expect(links.length).toBeGreaterThanOrEqual(6);
  for (const [, link] of links) {
    const [target, fragment] = link.split("#");
    const path = resolve(dirname(docPath), target);
    expect(existsSync(path), `broken link: ${link}`).toBe(true);
    if (path === join(root, "CHANGELOG.md")) expect(headings).toContain(fragment);
  }
});
