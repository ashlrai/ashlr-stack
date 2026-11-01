import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = join(import.meta.dir, "../../..");

test("site changelog renders its release headings in descending version order", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const tokens = marked.lexer(published);
  const headings = tokens.filter((token) => token.type === "heading");
  expect(headings[0]).toMatchObject({ depth: 1, text: "Changelog" });
  expect(headings[1]).toMatchObject({ depth: 2, text: "Unreleased" });
  expect(headings.filter((heading) => heading.depth === 1)).toHaveLength(1);

  const releases = headings.filter((heading) => heading.depth === 2).slice(1);
  expect(releases.length).toBeGreaterThan(0);
  const versions = releases.map((heading) => {
    const match = heading.text.match(/^\[?(\d+)\.(\d+)\.(\d+)\]?/);
    expect(match).not.toBeNull();
    return match?.slice(1).map(Number) ?? [];
  });
  for (let i = 1; i < versions.length; i++) {
    const previous = versions[i - 1];
    const current = versions[i];
    const firstDifference = previous.findIndex((part, index) => part !== current[index]);
    expect(firstDifference).toBeGreaterThanOrEqual(0);
    expect(previous[firstDifference]).toBeGreaterThan(current[firstDifference]);
  }

  for (let i = 1; i < headings.length; i++) {
    expect(headings[i].depth).toBeLessThanOrEqual(headings[i - 1].depth + 1);
  }
}, 30_000);

test("rendered 0.2.1 apply entry explains the removal of placeholder writes", async () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const release = published.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
  expect(release).toBeDefined();

  const html = await marked.parse(release ?? "");
  const entries = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)]
    .map((match) => match[1])
    .filter((entry) => entry.includes("<code>stack apply</code> stops attempting to write placeholder secrets"));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toContain("The wiring step never writes to the vault or fills in missing values.");
  expect(entries[0]).toContain("Previously, wiring ran <code>phantom add &lt;KEY&gt; TODO_STACK_APPLY --rotate</code>");
  expect(entries[0]).toContain("every call failed");
});

test("rendered 0.2.1 apply entry tells operators how to supply missing values", async () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const release = published.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
  expect(release).toBeDefined();

  const html = await marked.parse(release ?? "");
  const entries = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)]
    .map((match) => match[1])
    .filter((entry) => entry.includes("<code>stack apply</code> stops attempting to write placeholder secrets"));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toContain("The wiring step never writes to the vault or fills in missing values.");
  expect(entries[0]).toContain(
    "users must supply each required missing value themselves: run <code>phantom add &lt;NAME&gt;</code> from a trusted terminal and enter the real value.",
  );
  expect(entries[0]).toContain("If it cannot read the vault, it reports providers as skipped instead of identifying missing names.");
});

const placeholderRemovalHeading = "- **`stack apply` stops attempting to write placeholder secrets.**";

// Pin the historical entry so matching edits to both copies cannot silently reverse
// its meaning. Deliberate changes to this contract require updating this check.
const placeholderRemovalEntry = [
  placeholderRemovalHeading,
  "The wiring step never writes to the vault or fills in missing values.",
  "Provider setup may already store real values; users must supply each required missing value themselves: run `phantom add <NAME>` from a trusted terminal and enter the real value.",
  "When the vault is readable, wiring checks names using `phantom list --json` and prints `secrets in vault N · missing M · webhooks K`, plus a `not in Phantom:` line for missing names.",
  "If it cannot read the vault, it reports providers as skipped instead of identifying missing names.",
  "Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`) for every declared secret.",
  "Phantom Secrets refuses values in argv and has no `--rotate`, so every call failed and the printed `envelopes` count was always 0.",
  "`WireResult.envelopes` is replaced by `present` and `missing`.",
  "(Successor to #33.)",
].join(" ");

function invalidPlaceholderRemovalEntries(source: string, published: string): string[] {
  return [
    ["CHANGELOG.md", source],
    ["packages/site/src/data/CHANGELOG.md", published],
  ]
    .filter(([, changelog]) => {
      const entries = changelog.split("\n").filter((line) => line.startsWith(placeholderRemovalHeading));
      return entries.length !== 1 || entries[0] !== placeholderRemovalEntry;
    })
    .map(([path]) => path);
}

test("both changelogs include the apply placeholder-removal entry", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(invalidPlaceholderRemovalEntries(source, published)).toEqual([]);
});

test.each([
  [placeholderRemovalEntry, "", ["packages/site/src/data/CHANGELOG.md"]],
  ["", placeholderRemovalEntry, ["CHANGELOG.md"]],
  ["", "", ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"]],
  [placeholderRemovalEntry, placeholderRemovalEntry, []],
])("placeholder-removal check reports each missing copy", (source, published, invalid) => {
  expect(invalidPlaceholderRemovalEntries(source, published)).toEqual(invalid);
});

test("placeholder-removal check rejects changed or duplicated behavior in either copy", () => {
  const contradictory = placeholderRemovalEntry.replace(
    "The wiring step never writes to the vault or fills in missing values.",
    "The wiring step writes placeholder values to the vault.",
  );
  const appendedContradiction = `${placeholderRemovalEntry} Wiring now creates placeholders.`;
  const duplicated = `${placeholderRemovalEntry}\n${placeholderRemovalEntry}`;
  const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

  for (const invalid of [placeholderRemovalHeading, contradictory, appendedContradiction, duplicated]) {
    expect(invalidPlaceholderRemovalEntries(invalid, placeholderRemovalEntry)).toEqual([paths[0]]);
    expect(invalidPlaceholderRemovalEntries(placeholderRemovalEntry, invalid)).toEqual([paths[1]]);
    expect(invalidPlaceholderRemovalEntries(invalid, invalid)).toEqual(paths);
  }
});

test("site changelog mirrors the source and explains apply's placeholder behavior", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(published).toBe(source);
  expect(published).not.toContain("`stack apply` stops writing placeholder secrets");

  const applyEntry = published
    .split("\n")
    .find((line) => line.startsWith("- **`stack apply [recipe-id]`**"));
  expect(applyEntry).toContain(
    "Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder for each declared secret, but those calls failed; the 0.2.1 fix above removed the attempts.",
  );
  expect(applyEntry).toContain(
    "Wiring no longer attempts to write placeholder values; it does not write to the vault or fill in missing values.",
  );
  expect(applyEntry).toContain("Provider setup may already store real values");
  expect(applyEntry).toContain("wiring reports how many secret names are present and missing and lists missing names");
  expect(applyEntry).toContain("Missing names alone do not make apply fail; provider failures still do.");
  expect(applyEntry).toContain("wiring reports providers as skipped instead of identifying missing names");
  expect(applyEntry).toContain("creates webhook stubs (Stripe, Clerk, Supabase, GitHub)");
  expect(applyEntry).toContain("Wiring is on by default; `--noWire` opts out");

  const fixEntry = published.split("\n").find((line) => line.startsWith(placeholderRemovalHeading));
  expect(fixEntry).toContain("The wiring step never writes to the vault or fills in missing values.");
  expect(fixEntry).toContain("Provider setup may already store real values");
  expect(fixEntry).toContain("users must supply each required missing value themselves");
  expect(fixEntry).toContain("it reports providers as skipped instead of identifying missing names");
  expect(fixEntry).toContain("Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`");
  expect(fixEntry).toContain("every call failed and the printed `envelopes` count was always 0");
  expect(applyEntry).toContain("Users must supply each required missing value");
  for (const entry of [applyEntry, fixEntry])
    expect(entry).toContain("run `phantom add <NAME>` from a trusted terminal and enter the real value");
});

test("apply note explains the action required even after success", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const release = published.split("## 0.3.0 (2026-10-31)\n")[1]?.split("\n## ")[0];
  const entry = release?.split("\n").find((line) => line.startsWith("- After at least one provider succeeds, `stack apply`"));
  expect(entry).toContain("without creating placeholders or filling missing values");
  expect(entry).toContain("Provider setup may store real values separately");
  expect(entry).toContain("each required missing value needs user action");
  expect(entry).toContain("run `phantom add <NAME>` in a trusted terminal and enter the real value");
  expect(entry).toContain("Missing names alone do not make apply fail");
  expect(entry).toContain("If the vault cannot be read, providers are reported as skipped");
});

test("unreleased apply note describes wiring after a partial failure", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const unreleased = published.split("## Unreleased\n")[1]?.split("\n## ")[0];
  expect(unreleased).toContain("`stack apply` does not create placeholder secrets");
  expect(unreleased).toContain("every provider in the recipe, including providers that failed");
  expect(unreleased).toContain("a missing name does not itself fail apply, while provider failures do");
  expect(unreleased).toContain("even if the vault is unreadable");
  expect(unreleased).toContain("`--noWire` skips both checks and stubs");
});
