import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries } from "./changelog-parser-utils";

/** Reduces an entry to its punctuation characters, in source order. */
const punctuation = (entry: string) => entry.replace(/[^,():;]/g, "");

const source = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const fixture = readFileSync(new URL("./__fixtures__/changelog-punctuation.md", import.meta.url), "utf8");

test("parsed entry preserves parentheses and colons inside and outside them", () => {
  const markdown = `## Unreleased
### Fixed
- Diagnostics (scope: fleet): retain the original message (including nested (details)).
`;
  expect(sectionEntries(markdown)).toEqual([
    {
      version: "## Unreleased",
      section: "Fixed",
      entries: ["Diagnostics (scope: fleet): retain the original message (including nested (details))."],
    },
  ]);
});

test("CHANGELOG.md entry keeps commas, parentheses and a colon in order", () => {
  const unreleased = sectionEntries(source).find((g) => g.version === "## Unreleased" && g.section === "Fixed");
  const entry = unreleased?.entries.find((e) => e.startsWith("Fleet JSONL reads"));
  expect(entry).toBeDefined();
  expect(entry).toContain("reads (`stack fleet` diagnostics) now enforce the byte cap while reading: a non-tail read grows one buffer up to the cap, probes");
  expect(entry).toEndWith("whole file first (#360).");
  // Parenthetical, colon, two commas, two more parentheticals — nothing dropped or reordered.
  expect(punctuation(entry as string)).toBe("():,,()()");
});

test("fixture entry keeps commas, parentheses and a colon in order", () => {
  const fixed = sectionEntries(fixture).find((g) => g.version.includes("0.3.0") && g.section === "Fixed");
  expect(fixed?.entries[0]).toBe("Fixed timeout handling: connections now close cleanly (fixes #456, closes #457).");
  expect(punctuation(fixed?.entries[0] as string)).toBe(":(,)");
  expect(punctuation(fixed?.entries[1] as string)).toBe(":,(:)()");
});

/**
 * Punctuation-preservation fixture mirroring the real CHANGELOG.md style.
 *
 * CHANGELOG.md entries characteristically mix semicolons (multi-clause sentences),
 * colons (introductions), parentheses (references, parentheticals), commas, and
 * backtick inline code. This fixture exercises that combination so the parser can't
 * silently strip or reorder any of them.
 */
const changelogFixture = readFileSync(new URL("./__fixtures__/changelog-changelog-punctuation.md", import.meta.url), "utf8");

test("changelog-punctuation fixture: Unreleased Changed entry preserves semicolons and backticks", () => {
  const changed = sectionEntries(changelogFixture).find(
    (g) => g.version === "## Unreleased" && g.section === "Changed",
  );
  expect(changed).toBeDefined();
  const entry = changed!.entries[0];
  expect(entry).toBe(
    "`stack apply` does not create placeholder secrets; wiring checks secret names for every provider; a missing name does not fail apply; `--noWire` skips both checks.",
  );
  // Three semicolons — no colons, commas, or parens
  expect(punctuation(entry)).toBe(";;;");
  expect(entry).toContain("`stack apply`");
  expect(entry).toContain("`--noWire`");
});

test("changelog-punctuation fixture: Unreleased Fixed entry preserves parens, colon, commas", () => {
  const fixed = sectionEntries(changelogFixture).find(
    (g) => g.version === "## Unreleased" && g.section === "Fixed",
  )!;
  const entry = fixed.entries[0];
  expect(entry).toContain("(`stack fleet` diagnostics)");
  expect(entry).toContain("while reading:");
  expect(entry).toContain("(negative or non-integer)");
  expect(entry).toEndWith("(#100).");
  // ( ) : , , ( ) ( )
  expect(punctuation(entry)).toBe("():,,()()");
});

test("changelog-punctuation fixture: 0.3.0 Fixed Homebrew entry preserves parens, comma, parens", () => {
  const fixed = sectionEntries(changelogFixture).find(
    (g) => g.version.includes("0.3.0") && g.section === "Fixed",
  )!;
  const homebrewEntry = fixed.entries[0];
  expect(homebrewEntry).toContain("`$VERSION$`");
  expect(homebrewEntry).toContain("`$SHA_*$`");
  expect(homebrewEntry).toContain("`sed`");
  expect(homebrewEntry).toContain("`$` delimiters (#200).");
  // ( ) , ( )
  expect(punctuation(homebrewEntry)).toBe("(),()");
});

test("changelog-punctuation fixture: 0.3.0 Fixed multi-referenced entry preserves colon and parens", () => {
  const fixed = sectionEntries(changelogFixture).find(
    (g) => g.version.includes("0.3.0") && g.section === "Fixed",
  )!;
  const entry = fixed.entries[1];
  expect(entry).toBe("Multiple issue references: resolved (#300, #301) and closed (#302).");
  // : ( , ) ( )
  expect(punctuation(entry)).toBe(":(,)()");
});

test("changelog-punctuation fixture: Added entry with colon and long comma-separated list", () => {
  const added = sectionEntries(changelogFixture).find(
    (g) => g.version.includes("0.3.0") && g.section === "Added",
  )!;
  const entry = added.entries[0];
  expect(entry).toContain("Fleet diagnostics:");
  expect(entry).toContain("lanes, supply, latency, lag, waste, reds, silent jobs, collisions, delivery lag, stuck jobs, SLOs, activity, stream, graph and bets");
  expect(entry).toContain("`stack fleet`");
  // Colon, then 14 commas
  expect(punctuation(entry)).toBe(":,,,,,,,,,,,,,,");
});

test("changelog-punctuation fixture: Documentation entry preserves comma, parens-with-comma, backticks", () => {
  const doc = sectionEntries(changelogFixture).find(
    (g) => g.version.includes("0.3.0") && g.section === "Documentation",
  )!;
  const entry = doc.entries[0];
  expect(entry).toContain("Setup, README and package READMEs");
  expect(entry).toContain("(0.3.1 for `@ashlr/stack-core`, `@ashlr/stack` and `ashlr-stack-mcp`)");
  expect(entry).toContain("Node.js 20 or newer");
  // Comma before parens, comma inside parens, closing paren
  expect(punctuation(entry)).toBe(",(,)");
});
