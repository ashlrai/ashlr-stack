import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-placeholder-history.md");
const doc = readFileSync(docPath, "utf8");
const flat = doc.replace(/\s+/g, " ");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

function section(heading: string): string {
  const start = changelog.indexOf(`\n## ${heading}\n`);
  expect(start, `missing changelog section: ${heading}`).toBeGreaterThanOrEqual(0);
  return changelog.slice(start + 1).split("\n## ")[0];
}

test("history cites the changelog in chronological order", () => {
  const releases = [
    ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "010--2026-04-19-superseded-by-011", "those calls failed"],
    ["0.2.1 (2026-10-16)", "021-2026-10-16", "every call failed"],
    ["0.2.2 (2026-10-25)", "022-2026-10-25", "its npm publish failed"],
    ["0.3.0 (2026-10-31)", "030-2026-10-31", "unreadable vaults are reported as skipped"],
    ["Unreleased", "unreleased", "including providers that failed"],
  ];
  let previous = -1;
  for (const [heading, anchor, evidence] of releases) {
    expect(section(heading)).toContain(evidence);
    const position = doc.indexOf(`](../CHANGELOG.md#${anchor})`);
    expect(position, `missing or out-of-order citation: ${heading}`).toBeGreaterThan(previous);
    previous = position;
  }
  expect(section("0.1.0 — 2026-04-19 (superseded by 0.1.1)")).toContain(
    "calls failed; the 0.2.1 fix above removed the attempts",
  );
  expect(section("0.2.1 (2026-10-16)")).toContain("every call failed and the printed `envelopes` count was always 0");
});

test("history distinguishes failed attempts, their removal and current operation", () => {
  const history = doc.split("## Current behavior")[0].replace(/\s+/g, " ");
  const fix = section("0.2.1 (2026-10-16)");
  expect(fix).toMatch(/Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`[^.]*\. Phantom Secrets refuses values in argv and has no `--rotate`, so every call failed/);
  expect(fix).toContain("`phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`)");
  expect(fix).toContain("**`stack apply` stops attempting to write placeholder secrets.**");
  for (const detail of [
    "`phantom add <KEY> TODO_STACK_APPLY --rotate`",
    "`WireResult.envelopes`",
    "`present` and `missing`",
    "**`stack apply` stops attempting to write placeholder secrets.**",
  ]) {
    expect(fix).toContain(detail);
    expect(history).toContain(detail);
  }
  for (const claim of [
    "Those calls failed",
    "removed those attempts",
    "retried without `--rotate`",
    "Both attempts failed",
    "every call failed and the printed `envelopes` count was always zero",
    "do not run them",
    "0.2.1 was tagged but its npm publish failed",
  ]) {
    expect(history).toContain(claim);
  }
});

test("history summarises the 0.2.1 fix with the same terms as the changelog", () => {
  const fix = section("0.2.1 (2026-10-16)");
  for (const detail of [
    "phantom add <KEY> TODO_STACK_APPLY --rotate",
    "phantom list --json",
    "phantom add <NAME>",
    "WireResult.envelopes",
    "present",
    "missing",
    "skipped",
  ]) {
    expect(fix).toContain(detail);
    expect(doc).toContain(detail);
  }
});

test("history states what current wiring does and does not do", () => {
  for (const claim of [
    "it does not write to the vault or fill missing values",
    "an unreadable vault yields skipped providers",
    "Provider setup may separately store real credentials",
    "including failed providers",
    "If no provider succeeds, apply does not attempt wiring",
    "Missing names alone do not fail apply; provider failures do",
    "`--noWire` skips both checks and stubs",
    "`phantom add <NAME>` in a trusted terminal",
    "A successful apply alone does not establish that all required secrets are present",
  ]) {
    expect(flat).toContain(claim);
  }
});

test("history describes webhook stubs as commented, unsigned and still generated without an inventory", () => {
  const current = doc.split("## Current behavior")[1].replace(/\s+/g, " ");
  expect(current).toContain("creates commented webhook examples for Stripe, Clerk, Supabase, and GitHub under `.stack/webhooks/`");
  expect(current).toContain("even when the inventory is unreadable or the provider failed");
  expect(current).toContain("Repeated wiring overwrites an existing stub.");
  expect(current).toContain("These examples do not implement signature verification and must be completed before use.");
  expect(current).toContain("`--noWire` skips both the inventory check and webhook stubs");
  expect(current).toContain("A wiring error is reported as a warning and does not itself fail apply");
});

describe("history links", () => {
  test("every relative link resolves, including changelog heading fragments", () => {
    const headings = [...changelog.matchAll(/^#+ (.+)$/gm)].map((match) =>
      match[1].toLowerCase().replace(/[^\w\s-]/g, "").replace(/ /g, "-"),
    );
    const links = [...doc.matchAll(/\]\(([^)\s]+)\)/g)];
    expect(links.length).toBeGreaterThanOrEqual(6);
    for (const [, link] of links) {
      const [target, fragment] = link.split("#");
      const path = resolve(dirname(docPath), target);
      expect(existsSync(path), `broken link: ${link}`).toBe(true);
      if (fragment && path === join(root, "CHANGELOG.md")) expect(headings).toContain(fragment);
    }
  });

  test("the site changelog copy it points to mirrors the source", () => {
    for (const anchor of ["010--2026-04-19-superseded-by-011", "021-2026-10-16"]) {
      expect(doc).toContain(`](../packages/site/src/data/CHANGELOG.md#${anchor})`);
    }
    expect(readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8")).toBe(changelog);
  });
});
