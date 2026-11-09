import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const doc = readFileSync(join(root, "docs/apply-placeholder-history.md"), "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

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
    const start = changelog.indexOf(`\n## ${heading}\n`);
    expect(start, `missing changelog section: ${heading}`).toBeGreaterThanOrEqual(0);
    const section = changelog.slice(start + 1).split("\n## ")[0];
    expect(section).toContain(evidence);
    const position = doc.indexOf(`](../CHANGELOG.md#${anchor})`);
    expect(position, `missing or out-of-order citation: ${heading}`).toBeGreaterThan(previous);
    previous = position;
  }
});

test("history distinguishes failed attempts, their removal and current operation", () => {
  const history = doc.split("## Current behavior")[0].replace(/\s+/g, " ");
  const fix = changelog.split("## 0.2.1 (2026-10-16)")[1].split("\n## ")[0];
  expect(fix).toMatch(/Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`[^.]*\. Phantom Secrets refuses values in argv and has no `--rotate`, so every call failed/);
  for (const detail of ["`phantom add <KEY> TODO_STACK_APPLY --rotate`", "`WireResult.envelopes`", "`present` and `missing`"]) {
    expect(fix).toContain(detail);
    expect(history).toContain(detail);
  }
  for (const claim of ["Those calls failed", "removed those attempts", "do not run them", "its npm publish failed"]) {
    expect(history).toContain(claim);
  }
  expect(doc).toContain("`phantom add <NAME>` in a trusted terminal");
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
