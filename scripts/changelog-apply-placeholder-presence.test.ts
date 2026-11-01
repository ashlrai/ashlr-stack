import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"] as const;

test.each(paths)("%s uses the same historical placeholder literal in both apply entries", (path) => {
  const changelog = readFileSync(join(import.meta.dir, "..", path), "utf8");
  const fixEntry = changelog.split("\n").find((line) => line.startsWith("- **`stack apply` stops attempting"));
  const originalEntry = changelog.split("\n").find((line) => line.startsWith("- **`stack apply [recipe-id]`**"));
  const fixLiteral = fixEntry?.match(/Previously, wiring ran `phantom add <KEY> (\S+) --rotate`/)?.[1];
  const originalLiteral = originalEntry?.match(/Historically, wiring attempted to write a `([^`]+)` placeholder/)?.[1];

  expect(fixLiteral).toBe("TODO_STACK_APPLY");
  expect(originalLiteral).toBe(fixLiteral);
});

// Match the historical fix as one list item, regardless of inline Markdown or wrapping.
function hasPlaceholderFix(changelog: string): boolean {
  const release = changelog.match(/^##\s+\[?0\.2\.1\]?(?:\s|$)[^\n]*\n([\s\S]*?)(?=^##\s|$(?![\s\S]))/m)?.[1];
  if (!release) return false;
  const items = release.match(/^\s*[-*+]\s+[^\n]*(?:\n(?!\s*[-*+]\s|\s*#{1,6}\s)[^\n]*)*/gm) ?? [];
  return items.some((item) => {
    const text = item
      .replace(/[`*]|(?<!\w)_(?=\w)|(?<=\w)_(?!\w)/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    return (
      /stack apply stops attempting to write placeholder secrets\b/.test(text) &&
      /wiring step never writes to the vault or fills in missing values\b/.test(text) &&
      /previously, wiring ran phantom add <key> todo_stack_apply --rotate\b/.test(text) &&
      /every call failed\b/.test(text)
    );
  });
}

function bothHavePlaceholderFix(changelogs: readonly [string, string]): boolean {
  return changelogs.every(hasPlaceholderFix);
}

test.each(paths)("%s retains the stack apply placeholder fix", (path) => {
  const changelog = readFileSync(join(import.meta.dir, "..", path), "utf8");
  expect(hasPlaceholderFix(changelog), `${path} lacks the stack apply placeholder fix in 0.2.1`).toBe(true);
});

test("both changelogs state that stack apply stopped writing placeholders", () => {
  const changelogs = paths.map((path) => readFileSync(join(import.meta.dir, "..", path), "utf8")) as [
    string,
    string,
  ];
  expect(bothHavePlaceholderFix(changelogs)).toBe(true);

  // Unrelated prose can differ, but either copy losing the claim must fail.
  const surroundingProse = "Provider setup may already store real values";
  expect(changelogs[1]).toContain(surroundingProse);
  expect(bothHavePlaceholderFix([changelogs[0], changelogs[1].replace(surroundingProse, "Other setup details")])).toBe(
    true,
  );
  const claim = "The wiring step never writes to the vault or fills in missing values.";
  for (const index of [0, 1] as const) {
    const changed: [string, string] = [...changelogs];
    expect(changed[index]).toContain(claim);
    changed[index] = changed[index].replace(claim, "The wiring step writes placeholders to the vault.");
    expect(bothHavePlaceholderFix(changed)).toBe(false);
  }

  // A different value or loss of the historical qualifier in either copy is drift.
  for (const index of [0, 1] as const) {
    for (const [before, after] of [
      ["<KEY> TODO_STACK_APPLY --rotate", "<KEY> OTHER_VALUE --rotate"],
      ["Previously, wiring ran", "Wiring runs"],
      ["every call failed", "every call succeeded"],
    ]) {
      const changed: [string, string] = [...changelogs];
      expect(changed[index]).toContain(before);
      changed[index] = changed[index].replace(before, after);
      expect(bothHavePlaceholderFix(changed)).toBe(false);
    }
  }
});

test("placeholder fix detection accepts formatting differences within the entry", () => {
  const differentlyFormatted = `## [0.2.1] (2026-10-16)

### Bug fixes
* **stack apply** stops attempting to write
  placeholder secrets. The _wiring step never writes to the vault_
  or fills in missing values. Previously, wiring ran
  \`phantom add <KEY> TODO_STACK_APPLY --rotate\`; every call failed.
`;
  expect(hasPlaceholderFix(differentlyFormatted)).toBe(true);
});

test("placeholder fix detection requires the removal and history in the same 0.2.1 entry", () => {
  const title = "- `stack apply` stops attempting to write placeholder secrets.";
  const behavior = "The wiring step never writes to the vault or fills in missing values.";
  const history = "Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`; every call failed.";
  for (const changelog of [
    `## 0.2.1\n${title}\n`,
    `## 0.2.1\n- ${behavior}\n`,
    `## 0.2.1\n${title}\n- ${behavior}\n`,
    `## 0.2.1\n${title}\n## 0.2.2\n- ${behavior}\n`,
    `## 0.2.2\n${title} ${behavior}\n`,
    `## 0.2.1\n${title} ${behavior}\n- ${history}\n`,
    `## 0.2.1\n${title} ${behavior}\n## 0.2.2\n- ${history}\n`,
    `## 0.2.2\n${title} ${behavior} ${history}\n`,
  ]) {
    expect(hasPlaceholderFix(changelog)).toBe(false);
  }
});
