import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const changelog = readFileSync(join(import.meta.dir, "..", "CHANGELOG.md"), "utf8");

const RELEASE = "## 0.2.1 (2026-10-16)";
const HEADLINE = "`stack apply` stops attempting to write placeholder secrets";
const WIRING_CLAIM = "wiring step never writes to the vault or fills in missing values";

// The historical apply entry, as one list item inside the 0.2.1 release.
// Continuation lines (anything not starting a new item or heading) belong to
// the item above them; the entry must exist exactly once or the guard fails.
function applyStopEntry(text: string): string | undefined {
  const release = text.split(`${RELEASE}\n`)[1]?.split("\n## ")[0];
  const items = release?.match(/^- [^\n]*(?:\n(?!- |#)[^\n]*)*/gm) ?? [];
  const matches = items.filter((item) => item.includes(HEADLINE));
  return matches.length === 1 ? matches[0] : undefined;
}

// True only when the apply entry itself states the wiring step stopped writing
// placeholder secrets. The headline alone, or the same claim written under a
// different entry, does not count.
function statesWiringStopped(text: string): boolean {
  const entry = applyStopEntry(text);
  return entry !== undefined && entry.replace(/\s+/g, " ").includes(WIRING_CLAIM);
}

test("the historical stack apply entry states the wiring step stopped writing placeholder secrets", () => {
  const entry = applyStopEntry(changelog);
  expect(entry).toBeDefined();
  expect(entry).toContain("The wiring step never writes to the vault or fills in missing values.");
  expect(entry).toContain("Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`");
});

test("current wiring guidance stays separate from the historical command", () => {
  const entry = applyStopEntry(changelog);
  expect(entry).toBeDefined();
  const [current, historical, ...extra] = entry!.replace(/\s+/g, " ").split("Previously, wiring ran ");
  expect(extra).toHaveLength(0);
  expect(current).toContain("The wiring step never writes to the vault or fills in missing values.");
  expect(current).toContain("run `phantom add <NAME>` from a trusted terminal and enter the real value.");
  expect(current).not.toContain("TODO_STACK_APPLY");
  expect(historical).toStartWith("`phantom add <KEY> TODO_STACK_APPLY --rotate`");
  expect(historical).toContain("for every declared secret.");
});

test("the original 0.1.0 stack apply entry records the same stop", () => {
  const release = changelog.split("## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n")[1]?.split("\n## ")[0];
  const entries = release?.split("\n").filter((line) => line.startsWith("- **`stack apply [recipe-id]`**")) ?? [];
  expect(entries).toHaveLength(1);
  expect(entries[0]).toContain(
    "Wiring no longer attempts to write placeholder values; it does not write to the vault or fill in missing values.",
  );
});

test("the guard fails when the wiring claim leaves the entry", () => {
  const entry = applyStopEntry(changelog);
  expect(entry).toBeDefined();
  const claim = "The wiring step never writes to the vault or fills in missing values.";

  // Claim deleted outright.
  expect(statesWiringStopped(changelog.replace(claim, ""))).toBe(false);

  // Claim inverted.
  expect(
    statesWiringStopped(changelog.replace(claim, "The wiring step writes placeholders to the vault.")),
  ).toBe(false);

  // Claim moved to a different entry in the same release: the apply entry no
  // longer states it.
  const neighbor = "- **`stack apply` with a missing recipe writes nothing.**";
  const moved = changelog
    .replace(entry!, entry!.replace(claim, ""))
    .replace(neighbor, `- ${claim}\n${neighbor}`);
  expect(statesWiringStopped(moved)).toBe(false);
});

test("the guard fails when the entry is dropped or duplicated", () => {
  const entry = applyStopEntry(changelog);
  expect(entry).toBeDefined();
  expect(statesWiringStopped(changelog.replace(entry!, ""))).toBe(false);
  expect(statesWiringStopped(changelog.replace(entry!, `${entry}\n${entry}`))).toBe(false);
});

test("wrapping the entry across lines does not fool the guard either way", () => {
  const entry = applyStopEntry(changelog);
  expect(entry).toBeDefined();
  const claim = "The wiring step never writes to the vault or fills in missing values.";
  const wrapped = changelog.replace(
    entry!,
    entry!.replace(claim, "The wiring step\n  never writes to the vault or\n  fills in missing values."),
  );
  expect(statesWiringStopped(wrapped)).toBe(true);
});
