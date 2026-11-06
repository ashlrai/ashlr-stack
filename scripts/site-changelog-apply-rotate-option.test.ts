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
