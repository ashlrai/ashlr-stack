import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"] as const;
const changelogs = paths.map((path) => readFileSync(join(import.meta.dir, "..", path), "utf8")) as [string, string];

// Both entries record the placeholder `stack apply` wiring used to write: the
// 0.1.0 `stack apply [recipe-id]` entry keeps the historical attempt, and the
// 0.2.1 bug-fix entry names the value whose writes it removed.
const historicalEntries = [
  [
    "0.1.0 — 2026-04-19 (superseded by 0.1.1)",
    "- **`stack apply [recipe-id]`**",
    /Historically, wiring attempted to write a `([^`]+)` placeholder/,
  ],
  [
    "0.2.1 (2026-10-16)",
    "- **`stack apply` stops attempting to write placeholder secrets.**",
    /Previously, wiring ran `phantom add <KEY> ([^ `]+) --rotate`/,
  ],
] as const;

// The placeholder literal one entry identifies, or undefined when the release,
// the entry, or the name itself is missing (or the entry was duplicated).
function placeholderName(changelog: string, release: string, start: string, pattern: RegExp): string | undefined {
  const section = changelog.split(`## ${release}\n`)[1]?.split("\n## ")[0];
  const entries = section?.split("\n").filter((line) => line.startsWith(start)) ?? [];
  if (entries.length !== 1) return undefined;
  return entries[0].match(pattern)?.[1];
}

// True when every historical apply entry in both copies names one placeholder.
function samePlaceholder(pair: readonly [string, string]): boolean {
  const names = pair.flatMap((changelog) =>
    historicalEntries.map(([release, start, pattern]) => placeholderName(changelog, release, start, pattern)),
  );
  return names.every((name) => name !== undefined && name === names[0]);
}

test("both historical entries identify the same placeholder in each changelog", () => {
  for (const index of [0, 1] as const) {
    const [original, fix] = historicalEntries.map(([release, start, pattern]) =>
      placeholderName(changelogs[index], release, start, pattern),
    );
    expect(original, `${paths[index]}: 0.1.0 entry identifies no placeholder`).toBeDefined();
    expect(fix, `${paths[index]}: 0.2.1 entry identifies no placeholder`).toBeDefined();
    expect(fix).toBe(original);
    expect(original).toBe("TODO_STACK_APPLY");
  }
});

test("both changelogs identify the same historical placeholder", () => {
  expect(samePlaceholder(changelogs)).toBe(true);
});

test("the check rejects renamed, missing, or duplicated placeholders in either copy", () => {
  for (const index of [0, 1] as const) {
    for (const [, start] of historicalEntries) {
      const entry = changelogs[index].split("\n").find((line) => line.startsWith(start));
      expect(entry).toBeDefined();
      for (const replacement of [entry!.replace("TODO_STACK_APPLY", "STACK_APPLY_TODO"), "", `${entry}\n${entry}`]) {
        const changed: [string, string] = [...changelogs];
        changed[index] = changed[index].replace(entry!, replacement);
        expect(samePlaceholder(changed)).toBe(false);
      }
    }
    // Renaming the placeholder in both entries of one copy is still drift.
    const changed: [string, string] = [...changelogs];
    changed[index] = changed[index].replaceAll("TODO_STACK_APPLY", "STACK_APPLY_TODO");
    expect(samePlaceholder(changed)).toBe(false);
  }

  // A consistent rename across both copies stays consistent.
  const renamed = changelogs.map((changelog) =>
    changelog.replaceAll("TODO_STACK_APPLY", "STACK_APPLY_TODO"),
  ) as [string, string];
  expect(samePlaceholder(renamed)).toBe(true);
});
