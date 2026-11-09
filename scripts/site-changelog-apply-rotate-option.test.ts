import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const changelog = readFileSync(join(import.meta.dir, "..", "packages/site/src/data/CHANGELOG.md"), "utf8");

// The 0.2.1 bullet that documents the removal of placeholder writes.
function applyEntry(text: string): string {
  const section = text.split("\n## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0] ?? "";
  const bullets = section.split("\n- ").filter((bullet) => bullet.startsWith("**`stack apply` stops attempting"));
  expect(bullets).toHaveLength(1);
  return bullets[0];
}

test("site changelog stack apply entry retains the historical --rotate option", () => {
  const entry = applyEntry(changelog);
  expect(entry).toContain("Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`)");
  expect(entry).toContain("has no `--rotate`, so every call failed");
});

test("the --rotate option appears only as history, never as current guidance", () => {
  const entry = applyEntry(changelog);
  const before = entry.slice(0, entry.indexOf("Previously, "));
  expect(before).not.toContain("--rotate");
  expect(before).toContain("never writes to the vault");
});

const wireSource = readFileSync(join(import.meta.dir, "..", "packages/core/src/ai/phantom-wire.ts"), "utf8");

test("the --rotate command is attributed to older behavior in a past-tense sentence", () => {
  const entry = applyEntry(changelog);
  const sentences = entry.split(/(?<=\.) (?=[A-Z`])/);
  const historical = sentences.filter((sentence) => sentence.includes("--rotate"));
  // One sentence introduces the old command; the next explains why it failed.
  expect(historical).toHaveLength(2);
  expect(historical[0]).toStartWith("Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`");
  expect(historical[0]).toContain("for every declared secret");
  expect(historical[1]).toContain("has no `--rotate`");
  expect(historical[1]).toContain("every call failed");
});

test("the historical command is distinct from the current apply guidance", () => {
  const entry = applyEntry(changelog);
  const historicalAt = entry.indexOf("Previously, ");
  const current = entry.slice(0, historicalAt);
  const history = entry.slice(historicalAt);
  // Current behavior: user runs plain `phantom add <NAME>` with a real value; nothing is written by apply.
  expect(current).toContain("run `phantom add <NAME>` from a trusted terminal");
  expect(current).not.toContain("TODO_STACK_APPLY");
  expect(current).not.toContain("--rotate");
  // Old behavior: placeholder value plus --rotate, never the current command form.
  expect(history).toContain("TODO_STACK_APPLY --rotate");
  expect(history).not.toContain("trusted terminal");
});

test("current wiring code no longer issues the historical command", () => {
  expect(wireSource).not.toContain("--rotate");
  expect(wireSource).not.toContain("TODO_STACK_APPLY");
});
