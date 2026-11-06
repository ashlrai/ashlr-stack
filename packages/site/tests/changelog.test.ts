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

test("recommendation heading contains the apply entry about stopping placeholder writes", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const tokens = marked.lexer(published);
  const headings = tokens.filter(
    (token) => token.type === "heading" && token.depth === 3 && token.text === "AI recommendation layer — `stack recommend` + `stack apply`",
  );
  expect(headings).toHaveLength(1);

  const start = tokens.indexOf(headings[0]);
  const followingHeading = tokens.findIndex((token, index) => index > start && token.type === "heading" && token.depth <= 3);
  const section = tokens.slice(start + 1, followingHeading === -1 ? undefined : followingHeading);
  const entries = section.flatMap((token) => (token.type === "list" ? token.items : []));
  const applyEntries = entries.filter((entry) => entry.raw.startsWith("- **`stack apply [recipe-id]`**"));
  expect(applyEntries).toHaveLength(1);
  expect(applyEntries[0].raw).toContain("Wiring no longer attempts to write placeholder values; it does not write to the vault or fill in missing values.");
});

function historicalApplyReleases(markdown: string): (string | null)[] {
  let release: string | null = null;
  const releases: (string | null)[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      release = token.depth === 2 && /^(?:\[\d+\.\d+\.\d+\]|\d+\.\d+\.\d+)(?:\s|$)/.test(token.text) ? token.text : null;
    }
    if (token.type === "list") {
      for (const item of token.items) {
        if (item.raw.startsWith("- **`stack apply [recipe-id]`**")) releases.push(release);
      }
    }
  }
  return releases;
}

test("historical apply entry belongs to the 0.1.0 release", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(historicalApplyReleases(published)).toEqual(["0.1.0 — 2026-04-19 (superseded by 0.1.1)"]);
});

test("historical apply release detection respects Markdown section boundaries", () => {
  const entry = "- **`stack apply [recipe-id]`** — historical entry";
  expect(historicalApplyReleases(`${entry}\n`)).toEqual([null]);
  expect(historicalApplyReleases(`## Unreleased\n\n### Changed\n\n${entry}\n`)).toEqual([null]);
  expect(historicalApplyReleases(`## 0.1.0\n\n### Added\n\n${entry}\n`)).toEqual(["0.1.0"]);
  expect(historicalApplyReleases(`## [0.2.0] — date\n\n${entry}\n`)).toEqual(["[0.2.0] — date"]);
  expect(historicalApplyReleases(`## 0.1.0\n\n## Notes\n\n${entry}\n`)).toEqual([null]);
  expect(historicalApplyReleases(`## 0.1.0\n\n# Other\n\n${entry}\n`)).toEqual([null]);
  expect(historicalApplyReleases(`## 0.1.0\n\n${entry}\n\n## 0.2.0\n\n${entry}\n`)).toEqual(["0.1.0", "0.2.0"]);
  expect(historicalApplyReleases(`## 0.1.0\n\n\`\`\`md\n${entry}\n\`\`\`\n`)).toEqual([]);
});

test("parsing an empty changelog returns no sections or releases", () => {
  expect(marked.lexer("")).toEqual([]);
  expect(marked.lexer("").filter((token) => token.type === "heading")).toHaveLength(0);
  expect(historicalApplyReleases("")).toEqual([]);
  // Whitespace-only input is also empty: no headings, so no sections.
  expect(marked.lexer("\n\n  \n").filter((token) => token.type === "heading")).toHaveLength(0);
  expect(historicalApplyReleases("\n\n  \n")).toEqual([]);
});

test("source changelog historical apply entry is within a version section", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const releases = historicalApplyReleases(source);
  expect(releases).not.toContain(null);
});

test("source changelog historical apply entry belongs to the 0.1.0 release", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  expect(historicalApplyReleases(source)).toEqual(["0.1.0 — 2026-04-19 (superseded by 0.1.1)"]);
});

test("rendered original apply entry identifies the placeholder as historical", async () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const release = published.split("## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n")[1]?.split("\n## ")[0];
  expect(release).toBeDefined();

  const html = await marked.parse(release ?? "");
  const entries = [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)]
    .map((match) => match[1])
    .filter((entry) => entry.includes("<code>stack apply [recipe-id]</code>"));
  expect(entries).toHaveLength(1);
  expect(entries[0]).toContain(
    "Historically, wiring attempted to write a <code>TODO_STACK_APPLY</code> placeholder for each declared secret, but those calls failed; the 0.2.1 fix above removed the attempts.",
  );
  expect(entries[0]).toContain(
    "Wiring no longer attempts to write placeholder values; it does not write to the vault or fill in missing values.",
  );
});

test("the historical apply entry does not also claim wiring writes placeholders today", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const release = published.split("## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n")[1]?.split("\n## ")[0];
  expect(release).toBeDefined();

  const entries = marked.lexer(release ?? "").flatMap((token) => (token.type === "list" ? token.items : []));
  const applyEntries = entries.filter((entry) => entry.raw.startsWith("- **`stack apply [recipe-id]`**"));
  expect(applyEntries).toHaveLength(1);
  const entry = applyEntries[0].raw;
  expect(entry).toContain("Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder");
  expect(entry).toContain("Wiring no longer attempts to write placeholder values");
  expect(entry).not.toMatch(/\b(?:wiring|`stack apply`|it) (?:now |still )?(?:writes|creates|stores|adds) (?:a |the )?placeholder/i);
});

test("the original apply entry cannot describe placeholder writes as a current step", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const release = published.split("## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n")[1]?.split("\n## ")[0];
  const entries = marked.lexer(release ?? "").flatMap((token) => (token.type === "list" ? token.items : []));
  const applyEntries = entries.filter((entry) => entry.raw.startsWith("- **`stack apply [recipe-id]`**"));
  expect(applyEntries).toHaveLength(1);
  const entry = applyEntries[0].raw;
  expect(entry).toContain("Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder");

  // Catch an added present-tense claim even when the historical sentence remains intact.
  const currentWrite = /\b(?:writes|creates|stores|adds)\b[^.!?]*\bplaceholders?\b/i;
  expect(entry).not.toMatch(currentWrite);
  expect(`${entry} It then writes a \`TODO_STACK_APPLY\` placeholder for every secret.`).toMatch(currentWrite);
});


test("historical apply entry records cessation of placeholder writes", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const release = published.split("## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n")[1]?.split("\n## ")[0];
  expect(release).toBeDefined();

  const entries = marked.lexer(release ?? "").flatMap((token) => (token.type === "list" ? token.items : []));
  const applyEntry = entries.find((item) => item.raw.startsWith("- **`stack apply [recipe-id]`**"));
  expect(applyEntry).toBeDefined();

  // The entry must document that wiring stopped writing placeholder values.
  // Regression: if the 0.1.0 entry is edited and this sentence is dropped, the story is lost.
  expect(applyEntry.raw).toContain(
    "Wiring no longer attempts to write placeholder values; it does not write to the vault or fill in missing values.",
  );
  // The entry must also cite the 0.2.1 fix that removed the broken behavior.
  expect(applyEntry.raw).toContain("the 0.2.1 fix above removed the attempts");
});

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

test("rendered 0.2.1 apply change heading matches in both changelogs", async () => {
  const headings = await Promise.all(
    ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"].map(async (path) => {
      const changelog = readFileSync(join(root, path), "utf8");
      const release = changelog.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
      expect(release, path).toBeDefined();

      const html = await marked.parse(release ?? "");
      const matches = [...html.matchAll(/<li>(?:<p>)?<strong>(<code>stack apply<\/code>[^<]*)<\/strong>/g)];
      expect(matches, path).toHaveLength(1);
      return matches[0][1];
    }),
  );

  expect(headings[0]).toBe(headings[1]);
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

test("both changelogs file the placeholder-removal entry under the same 0.2.1 release", () => {
  const releases = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"].map((path) => {
    const changelog = readFileSync(join(root, path), "utf8");
    const release = changelog.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
    expect(release, path).toBeDefined();
    const entries = (release ?? "").split("\n").filter((line) => line.startsWith(placeholderRemovalHeading));
    expect(entries, path).toHaveLength(1);
    expect(entries[0], path).toBe(placeholderRemovalEntry);
    return entries[0];
  });
  expect(releases[0]).toBe(releases[1]);
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

/** Versions (e.g. "0.3.0") that appear in more than one `##` release heading. */
function duplicateVersions(markdown: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const token of marked.lexer(markdown)) {
    if (token.type !== "heading" || token.depth !== 2) continue;
    const match = token.text.match(/^\[?(\d+\.\d+\.\d+)\]?(?:\s|$)/);
    if (!match) continue;
    if (seen.has(match[1])) duplicates.add(match[1]);
    seen.add(match[1]);
  }
  return [...duplicates];
}

test("site changelog lists each version heading only once", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(duplicateVersions(published)).toEqual([]);
});

test("duplicate version detection catches repeats across heading styles", () => {
  expect(duplicateVersions("## 0.1.0\n\n## 0.2.0\n")).toEqual([]);
  expect(duplicateVersions("## 0.1.0\n\n## 0.1.0\n")).toEqual(["0.1.0"]);
  expect(duplicateVersions("## [0.2.0] — date\n\n## 0.2.0 (2026-01-01)\n")).toEqual(["0.2.0"]);
  expect(duplicateVersions("## 0.1.0\n\n### 0.1.0\n")).toEqual([]);
});

function releaseVersions(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .flatMap((token) => (token.type === "heading" && token.depth === 2 ? [token.text.match(/^\[?(\d+\.\d+\.\d+)\]?(?:\s|$)/)?.[1]] : []))
    .filter((version): version is string => version !== undefined);
}

test("blank lines between version entries keep both entries distinct and in input order", () => {
  const entry = (version: string) => `## ${version} (2026-01-01)\n\n### Added\n\n- item for ${version}\n`;
  const input = `# Changelog\n\n${entry("0.2.0")}\n\n\n${entry("0.1.0")}`;
  expect(releaseVersions(input)).toEqual(["0.2.0", "0.1.0"]);

  const releases = input.split(/\n(?=## )/).slice(1);
  expect(releases).toHaveLength(2);
  expect(releases[0]).toContain("item for 0.2.0");
  expect(releases[0]).not.toContain("0.1.0");
  expect(releases[1]).toContain("item for 0.1.0");
});

test("a single blank line, extra blank lines, or none before the next heading parse identically", () => {
  const body = (gap: string) => `## 0.2.0\n\n- a${gap}## 0.1.0\n\n- b\n`;
  for (const gap of ["\n", "\n\n", "\n\n\n\n"]) {
    expect(releaseVersions(body(gap))).toEqual(["0.2.0", "0.1.0"]);
    const lists = marked.lexer(body(gap)).flatMap((token) => (token.type === "list" ? token.items.map((item) => item.text) : []));
    expect(lists).toEqual(["a", "b"]);
  }
});

/** Entry texts (list items) of the `###` section titled `title` inside release `release`, in source order. */
function sectionEntries(markdown: string, release: string, title: string): string[] {
  const entries: string[] = [];
  let inRelease = false;
  let inSection = false;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 3) {
      if (token.depth <= 2) inRelease = token.depth === 2 && token.text === release;
      inSection = inRelease && token.depth === 3 && token.text === title;
    } else if (inSection && token.type === "list") {
      for (const item of token.items) entries.push(item.text.trim());
    }
  }
  return entries;
}

test("two entries in one section are returned in source order", () => {
  const input = "## 0.2.0\n\n### Added\n\n- zebra entry\n- alpha entry\n\n### Fixed\n\n- other entry\n";
  expect(sectionEntries(input, "0.2.0", "Added")).toEqual(["zebra entry", "alpha entry"]);
  // Reversing the source reverses the result, so order is not an artifact of sorting.
  const reversed = "## 0.2.0\n\n### Added\n\n- alpha entry\n- zebra entry\n";
  expect(sectionEntries(reversed, "0.2.0", "Added")).toEqual(["alpha entry", "zebra entry"]);
});

test("entries split by a blank line or an interleaved paragraph stay in source order", () => {
  const input = "## 0.2.0\n\n### Added\n\n- first\n\n- second\n\nnote\n\n- third\n";
  expect(sectionEntries(input, "0.2.0", "Added")).toEqual(["first", "second", "third"]);
});

test("section entries do not leak across sections or releases", () => {
  const input = "## 0.2.0\n\n### Added\n\n- a\n- b\n\n### Fixed\n\n- c\n\n## 0.1.0\n\n### Added\n\n- d\n";
  expect(sectionEntries(input, "0.2.0", "Added")).toEqual(["a", "b"]);
  expect(sectionEntries(input, "0.1.0", "Added")).toEqual(["d"]);
  expect(sectionEntries(input, "0.3.0", "Added")).toEqual([]);
});

test("published changelog returns the 0.2.1 placeholder-removal entry in source order", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const lines = published.split("\n");
  const start = lines.indexOf("## 0.2.1 (2026-10-16)");
  expect(start).toBeGreaterThan(-1);
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  const section = lines.slice(start, end === -1 ? undefined : end);
  const heading = section.find((line) => line.startsWith("### "))?.slice(4) ?? "";
  const entries = sectionEntries(published, "0.2.1 (2026-10-16)", heading);
  expect(entries.length).toBeGreaterThanOrEqual(2);
  // Source order: each entry's first line appears in the file in the same sequence.
  const positions = entries.map((entry) => published.indexOf(entry.split("\n")[0]));
  expect(positions.every((p) => p >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
});

test("an entry keeps its inline-code content and belongs to the right version", () => {
  const input = [
    "## 0.2.0",
    "",
    "### Added",
    "",
    "- `stack apply [recipe-id]` writes `.stack.toml` and runs `bun run fresh:sync`",
    "- plain entry",
    "",
    "## 0.1.0",
    "",
    "### Added",
    "",
    "- `stack init --force` was the only way in",
    "",
  ].join("\n");
  expect(sectionEntries(input, "0.2.0", "Added")).toEqual([
    "`stack apply [recipe-id]` writes `.stack.toml` and runs `bun run fresh:sync`",
    "plain entry",
  ]);
  expect(sectionEntries(input, "0.1.0", "Added")).toEqual(["`stack init --force` was the only way in"]);

  // The lexer also exposes the code span as its own token with the exact content.
  const item = marked.lexer(input).flatMap((token) => (token.type === "list" ? token.items : []))[0];
  const codes = item.tokens.flatMap((token) => (token.type === "text" && token.tokens ? token.tokens : [token])).filter((token) => token.type === "codespan");
  expect(codes.map((code) => code.text)).toEqual(["stack apply [recipe-id]", ".stack.toml", "bun run fresh:sync"]);
});

test("heading-like text inside inline code does not start a new release or section", () => {
  const input = "## 0.2.0\n\n### Added\n\n- mention `## 0.1.0` and `### Fixed` literally\n- next `entry`\n\n## 0.1.0\n\n### Added\n\n- old\n";
  expect(releaseVersions(input)).toEqual(["0.2.0", "0.1.0"]);
  expect(sectionEntries(input, "0.2.0", "Added")).toEqual(["mention `## 0.1.0` and `### Fixed` literally", "next `entry`"]);
  expect(sectionEntries(input, "0.2.0", "Fixed")).toEqual([]);
  expect(sectionEntries(input, "0.1.0", "Added")).toEqual(["old"]);
});

test("double-backtick inline code keeps an embedded backtick and its release", () => {
  const input = "## 0.3.0\n\n### Changed\n\n- renamed ``a `b` c`` to `d`\n\n## 0.2.0\n\n### Changed\n\n- other\n";
  expect(sectionEntries(input, "0.3.0", "Changed")).toEqual(["renamed ``a `b` c`` to `d`"]);
  expect(sectionEntries(input, "0.2.0", "Changed")).toEqual(["other"]);
});

// ── Heading-only fixture: empty subsection parsing ──

type Parsed = { version: string; sections: { name: string; items: string[] }[] };

function parse(markdown: string): Parsed[] {
  const versions: Parsed[] = [];
  let version: Parsed | null = null;
  let section: Parsed["sections"][number] | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      section = null;
      version = token.depth === 2 && /^\[?\d+\.\d+\.\d+\]?(?:\s|$)/.test(token.text) ? { version: token.text, sections: [] } : null;
      if (version) versions.push(version);
    } else if (token.type === "heading" && token.depth === 3 && version) {
      section = { name: token.text, items: [] };
      version.sections.push(section);
    } else if (token.type === "list" && section) {
      for (const item of token.items) section.items.push(item.text);
    }
  }
  return versions;
}

test("heading-only fixture: empty ### section is kept with no entries", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-section-heading.md"), "utf8");
  const parsed = parse(fixture);
  expect(parsed.map((v) => v.version)).toEqual(["0.2.0 (2026-04-23)", "0.1.0 (2026-04-19)"]);
  expect(parsed[0].sections).toEqual([{ name: "Added", items: ["Entry."] }]);
  expect(parsed[1].sections).toEqual([{ name: "Fixed", items: [] }]);
});

test("heading-only fixture: empty subsection does not throw", () => {
  const fixture = readFileSync(join(import.meta.dir, "__fixtures__/changelog-empty-section-heading.md"), "utf8");
  expect(() => parse(fixture)).not.toThrow();
});

test("heading-only fixture: published CHANGELOG.md parses without error and handles all sections", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  expect(() => parse(published)).not.toThrow();
  const parsed = parse(published);
  expect(parsed.length).toBeGreaterThan(0);
  // Every section has a name (even if its item list is empty)
  expect(parsed.flatMap((v) => v.sections.map((s) => s.name))).toBeTruthy();
});

// Single-version, single-entry fixture in the shape of src/data/CHANGELOG.md.
const SINGLE_ENTRY = "CLI lazily loads the selected command rather than all commands at startup.";
const SINGLE_ENTRY_FIXTURE = `# Changelog

## 0.3.0 (2026-10-31)

### Changed and fixed

- ${SINGLE_ENTRY}
`;

function parseReleaseEntries(markdown: string): { version: string; entries: string[] }[] {
  const releases: { version: string; entries: string[] }[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth === 2) {
      const match = token.text.match(/^\[?(\d+\.\d+\.\d+)\]?/);
      releases.push({ version: match?.[1] ?? token.text, entries: [] });
    } else if (token.type === "list" && releases.length > 0) {
      releases[releases.length - 1].entries.push(...token.items.map((item) => item.text));
    }
  }
  return releases;
}

test("single-version, single-entry fixture parses to its version and entry text", () => {
  expect(parseReleaseEntries(SINGLE_ENTRY_FIXTURE)).toEqual([{ version: "0.3.0", entries: [SINGLE_ENTRY] }]);
});

test("the fixture's version and entry text match the published site changelog", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const release = parseReleaseEntries(published).find((r) => r.version === "0.3.0");
  expect(release).toBeDefined();
  expect(release?.entries).toContain(SINGLE_ENTRY);
});

// Trailing-newline fixture: the same changelog with and without its final newline.
const NO_FINAL_NEWLINE_FIXTURE = SINGLE_ENTRY_FIXTURE.replace(/\n+$/, "");

test("trailing-newline fixture differs only by its final newline", () => {
  expect(SINGLE_ENTRY_FIXTURE.endsWith("\n")).toBe(true);
  expect(NO_FINAL_NEWLINE_FIXTURE.endsWith("\n")).toBe(false);
  expect(`${NO_FINAL_NEWLINE_FIXTURE}\n`).toBe(SINGLE_ENTRY_FIXTURE);
});

test("a version and its entry parse identically with and without a final newline", () => {
  const expected = [{ version: "0.3.0", entries: [SINGLE_ENTRY] }];
  expect(parseReleaseEntries(NO_FINAL_NEWLINE_FIXTURE)).toEqual(expected);
  expect(parseReleaseEntries(SINGLE_ENTRY_FIXTURE)).toEqual(expected);
});

test("the published site changelog parses identically with and without its final newline", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const trimmed = published.replace(/\n+$/, "");
  expect(trimmed.endsWith("\n")).toBe(false);
  expect(parseReleaseEntries(trimmed)).toEqual(parseReleaseEntries(`${trimmed}\n`));
  expect(parseReleaseEntries(trimmed).length).toBeGreaterThan(0);
});

// Fixture modeled on the 0.1.0 `stack apply` entry in CHANGELOG.md: a list entry with a Markdown link.
const LINK_ENTRY_FIXTURE = [
  "## 0.1.0",
  "",
  "### Added",
  "",
  "- **`stack apply [recipe-id]`** — checks declared secret names in [Phantom](https://phm.dev) and creates webhook stubs.",
  "",
].join("\n");

function linksInEntry(markdown: string, prefix: string): { text: string; href: string }[] {
  const entry = marked
    .lexer(markdown)
    .flatMap((token) => (token.type === "list" ? token.items : []))
    .find((item) => item.raw.startsWith(prefix));
  expect(entry).toBeDefined();
  const links: { text: string; href: string }[] = [];
  marked.walkTokens(entry?.tokens ?? [], (token) => {
    if (token.type === "link") links.push({ text: token.text, href: token.href });
  });
  return links;
}

test("fixture entry with a Markdown link keeps its link text and destination", async () => {
  expect(linksInEntry(LINK_ENTRY_FIXTURE, "- **`stack apply [recipe-id]`**")).toEqual([
    { text: "Phantom", href: "https://phm.dev" },
  ]);
  const html = await marked.parse(LINK_ENTRY_FIXTURE);
  expect(html).toContain('<a href="https://phm.dev">Phantom</a>');
  // Brackets in the entry's code span are not mistaken for a link.
  expect(html).toContain("<code>stack apply [recipe-id]</code>");
});

test("source changelog apply entry keeps its Phantom link text and destination", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  expect(linksInEntry(source, "- **`stack apply [recipe-id]`**")).toContainEqual({
    text: "Phantom",
    href: "https://phm.dev",
  });
});

test("parsed changelog entries preserve colons and commas", () => {
  const entry = "Fixed: wiring skips unset keys, then continues with the rest";
  const markdown = `## 0.1.0\n\n### Fixed\n\n- ${entry}\n- **Note:** plain, bold lead-in\n`;
  const items = marked.lexer(markdown).flatMap((token) => (token.type === "list" ? token.items : []));
  expect(items.map((item) => item.text)).toEqual([entry, "**Note:** plain, bold lead-in"]);
  for (const item of items) {
    expect(item.text).toContain(":");
    expect(item.text).toContain(",");
  }
});

test("source changelog entries with a colon and comma keep both in parsed text", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const items = marked.lexer(source).flatMap((token) => (token.type === "list" ? token.items : []));
  const raw = items.find((item) => item.raw.startsWith("- **`stack apply [recipe-id]`**"));
  expect(raw).toBeDefined();
  const withBoth = items.filter((item) => item.text.includes(":") && item.text.includes(","));
  expect(withBoth.length).toBeGreaterThan(0);
  for (const item of withBoth) {
    expect(item.raw).toContain(":");
    expect(item.raw).toContain(",");
  }
});

type ParsedRelease = { heading: string; entries: string[] };

// Collects each "## <version>" release and its list entries (across ### groups) in source order.
function parseReleases(markdown: string): ParsedRelease[] {
  const releases: ParsedRelease[] = [];
  let current: ParsedRelease | null = null;
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth <= 2) {
      current = token.depth === 2 ? { heading: token.text, entries: [] } : null;
      if (current) releases.push(current);
    } else if (current && token.type === "list") {
      for (const item of token.items) current.entries.push(item.text);
    }
  }
  return releases;
}

test("parseReleases keeps two successive releases and their entries in source order", () => {
  const sample = "# Changelog\n\n## 2.0.0\n\n### Added\n\n- b1\n- b2\n\n### Fixed\n\n- b3\n\n## 1.0.0\n\n- a1\n- a2\n";
  expect(parseReleases(sample)).toEqual([
    { heading: "2.0.0", entries: ["b1", "b2", "b3"] },
    { heading: "1.0.0", entries: ["a1", "a2"] },
  ]);
});

test("source changelog 0.3.0 and 0.2.2 are successive and their entries stay in source order", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const releases = parseReleases(source);
  const index = releases.findIndex((release) => release.heading.startsWith("0.3.0"));
  expect(index).toBeGreaterThanOrEqual(0);
  const [newer, older] = [releases[index], releases[index + 1]];
  expect(older?.heading.startsWith("0.2.2")).toBe(true);

  const offsetOf = (release: ParsedRelease) => {
    const start = source.indexOf(`## ${release.heading}`);
    expect(start).toBeGreaterThanOrEqual(0);
    return start;
  };
  expect(offsetOf(newer)).toBeLessThan(offsetOf(older));

  for (const release of [newer, older]) {
    expect(release.entries.length).toBeGreaterThan(0);
    // Each entry's first line must appear in the raw source after the previous entry's.
    let cursor = offsetOf(release);
    for (const entry of release.entries) {
      const at = source.indexOf(entry.split("\n")[0], cursor);
      expect(at, `${release.heading}: ${entry.slice(0, 40)}`).toBeGreaterThanOrEqual(cursor);
      cursor = at + 1;
    }
  }

  // Anchor the first entry of each release, so a reorder at either boundary is caught.
  expect(newer.entries[0]).toMatch(/^Fleet diagnostics: lanes/);
  expect(older.entries[0]).toMatch(/^Release: npm publishing relies only on npm trusted publishing/);
});

// Walk every list item (including nested ones) and return the inline code spans it holds.
function codespansByEntry(markdown: string): { raw: string; codespans: string[] }[] {
  const found: { raw: string; codespans: string[] }[] = [];
  const visit = (tokens: ReturnType<typeof marked.lexer>) => {
    for (const token of tokens) {
      if (token.type !== "list") continue;
      for (const item of token.items) {
        const spans: string[] = [];
        marked.walkTokens(item.tokens, (t) => {
          if (t.type === "codespan") spans.push(t.text);
        });
        found.push({ raw: item.raw, codespans: spans });
        visit(item.tokens as ReturnType<typeof marked.lexer>);
      }
    }
  };
  visit(marked.lexer(markdown));
  return found;
}

test("parsed changelog entries keep the TODO_STACK_APPLY marker intact", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const entries = codespansByEntry(published).filter((entry) => entry.raw.includes("TODO_STACK_APPLY"));
  // One in 0.2.1 (the fix) and one in 0.1.0 (the original apply entry).
  expect(entries.length).toBeGreaterThanOrEqual(2);
  for (const entry of entries) {
    // Not split, escaped, or mangled by the parser: every occurrence is whole in the raw source...
    expect(entry.raw.match(/TODO_STACK_APPLY/g)?.length).toBe(entry.raw.match(/\bTODO_STACK_APPLY\b/g)?.length);
    expect(entry.raw).not.toMatch(/TODO\\_STACK|TODO_\\STACK|STACK\\_APPLY|TODO_STACK_ APPLY/);
    // ...and the parser keeps it whole inside an inline code span.
    expect(entry.codespans.some((span) => span.includes("TODO_STACK_APPLY"))).toBe(true);
  }
  // The exact span text for each known entry survives parsing.
  const spans = entries.flatMap((entry) => entry.codespans);
  expect(spans).toContain("TODO_STACK_APPLY");
  expect(spans).toContain("phantom add <KEY> TODO_STACK_APPLY --rotate");
});

test("marker survival check detects a mangled TODO_STACK_APPLY marker", () => {
  const whole = codespansByEntry("- wrote `TODO_STACK_APPLY` once\n");
  expect(whole[0].codespans).toEqual(["TODO_STACK_APPLY"]);
  // Emphasis parsing eats underscores outside code spans, so the marker must stay in backticks.
  const bare = codespansByEntry("- wrote TODO_STACK_APPLY once\n");
  expect(bare[0].codespans).toEqual([]);
  // Nested list items are visited too.
  const nested = codespansByEntry("- outer\n  - inner `TODO_STACK_APPLY`\n");
  expect(nested.some((entry) => entry.codespans.includes("TODO_STACK_APPLY"))).toBe(true);
});

function entryLinks(entry: { tokens: { type: string; tokens?: unknown[] }[] }): { text: string; href: string }[] {
  const links: { text: string; href: string }[] = [];
  const walk = (tokens: unknown[]) => {
    for (const token of tokens as { type: string; text?: string; href?: string; tokens?: unknown[] }[]) {
      if (token.type === "link") links.push({ text: token.text ?? "", href: token.href ?? "" });
      if (token.tokens) walk(token.tokens);
    }
  };
  walk(entry.tokens);
  return links;
}

test("parsed changelog entry keeps Markdown link text and destination", () => {
  const entry = "- See [Phantom](https://phm.dev) for secrets and the [docs](https://stack.ashlr.ai/docs \"Docs\").\n";
  const [item] = marked.lexer(entry).flatMap((token) => (token.type === "list" ? token.items : []));
  expect(item.raw).toContain("[Phantom](https://phm.dev)");
  expect(entryLinks(item)).toEqual([
    { text: "Phantom", href: "https://phm.dev" },
    { text: "docs", href: "https://stack.ashlr.ai/docs" },
  ]);
});

test("published 0.1.0 apply entry keeps its Phantom link text and destination", async () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const release = published.split("## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n")[1]?.split("\n## ")[0];
  const entries = marked.lexer(release ?? "").flatMap((token) => (token.type === "list" ? token.items : []));
  const applyEntry = entries.find((item) => item.raw.startsWith("- **`stack apply [recipe-id]`**"));
  expect(applyEntry).toBeDefined();
  expect(applyEntry?.raw).toContain("[Phantom](https://phm.dev)");
  expect(entryLinks(applyEntry as never)).toContainEqual({ text: "Phantom", href: "https://phm.dev" });

  const html = await marked.parse(applyEntry?.raw ?? "");
  expect(html).toContain('<a href="https://phm.dev">Phantom</a>');
});

// Ordered release versions (`## 0.3.0 …`, `## [0.2.0] …`) found in a changelog; "Unreleased" is skipped.
function releaseVersions(markdown: string): string[] {
  return marked
    .lexer(markdown)
    .flatMap((token) =>
      token.type === "heading" && token.depth === 2 ? [token.text.match(/^\[?(\d+\.\d+\.\d+)\]?(?:\s|$)/)?.[1] ?? null] : [],
    )
    .filter((version): version is string => version !== null);
}

test("site changelog lists the same release versions, in the same order, as the root changelog", () => {
  const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const expected = releaseVersions(source);
  expect(expected.length).toBeGreaterThan(0);
  expect(releaseVersions(published)).toEqual(expected);
});

test("release version comparison detects a missing or reordered heading", () => {
  const source = "# Changelog\n\n## Unreleased\n\n## 0.3.0 (2026-10-31)\n\n## [0.2.0] — 2026-04-23\n\n## 0.1.1 — 2026-04-19\n";
  const missing = source.replace("## [0.2.0] — 2026-04-23\n\n", "");
  const reordered = source.replace("## 0.3.0 (2026-10-31)", "## 0.2.0-tmp").replace("## [0.2.0] — 2026-04-23", "## 0.3.0 (2026-10-31)").replace("## 0.2.0-tmp", "## [0.2.0] — 2026-04-23");
  expect(releaseVersions(source)).toEqual(["0.3.0", "0.2.0", "0.1.1"]);
  expect(releaseVersions(missing)).not.toEqual(releaseVersions(source));
  expect(releaseVersions(reordered)).toEqual(["0.2.0", "0.3.0", "0.1.1"]);
});


test("original apply entry points back to the placeholder fix in the published release history", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const tokens = marked.lexer(published);
  const fixRelease = tokens.findIndex((token) => token.type === "heading" && token.depth === 2 && token.text === "0.2.1 (2026-10-16)");
  const originalRelease = tokens.findIndex(
    (token) => token.type === "heading" && token.depth === 2 && token.text === "0.1.0 — 2026-04-19 (superseded by 0.1.1)",
  );
  expect(fixRelease).toBeGreaterThanOrEqual(0);
  expect(originalRelease).toBeGreaterThan(fixRelease);

  const nextRelease = (start: number) => {
    const index = tokens.findIndex((token, i) => i > start && token.type === "heading" && token.depth === 2);
    return index === -1 ? tokens.length : index;
  };
  const entriesInRelease = (start: number) =>
    tokens.slice(start + 1, nextRelease(start)).flatMap((token) => (token.type === "list" ? token.items : []));

  const fixes = entriesInRelease(fixRelease).filter((entry) =>
    entry.raw.startsWith("- **`stack apply` stops attempting to write placeholder secrets.**"),
  );
  expect(fixes).toHaveLength(1);
  expect(fixes[0].raw).toContain("The wiring step never writes to the vault or fills in missing values.");

  const originals = entriesInRelease(originalRelease).filter((entry) =>
    entry.raw.startsWith("- **`stack apply [recipe-id]`**"),
  );
  expect(originals).toHaveLength(1);
  expect(originals[0].raw).toContain("but those calls failed; the 0.2.1 fix above removed the attempts.");
  expect(originals[0].raw).toContain("Wiring no longer attempts to write placeholder values");
});


test("Original PR 752: a hyphenated-word entry retains its hyphenated text through the parser", () => {
  const input = [
    "## 0.4.0",
    "",
    "### Fixed",
    "",
    "- Fixed the well-known, long-standing, state-of-the-art re-run bug in non-interactive mode.",
    "- Kept self-hosted, pre-1.0, e-mail-style and cross-platform names like `--dry-run` intact.",
    "- Trailing hyphen- and leading -dash words stay as written.",
    "",
    "## 0.3.0",
    "",
    "### Added",
    "",
    "- Plain entry without hyphens.",
    "",
  ].join("\n");
  expect(sectionEntries(input, "0.4.0", "Fixed")).toEqual([
    "Fixed the well-known, long-standing, state-of-the-art re-run bug in non-interactive mode.",
    "Kept self-hosted, pre-1.0, e-mail-style and cross-platform names like `--dry-run` intact.",
    "Trailing hyphen- and leading -dash words stay as written.",
  ]);
  // Entries in the other version are not affected.
  expect(sectionEntries(input, "0.3.0", "Added")).toEqual(["Plain entry without hyphens."]);
});

test("Original PR 752: published changelog retains hyphenated words in its Unreleased Fixed section", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const entries = sectionEntries(published, "Unreleased", "Fixed");
  expect(entries.length).toBeGreaterThanOrEqual(1);
  const fleetEntry = entries[0];
  // Hyphenated words must survive the lexer round-trip intact.
  expect(fleetEntry).toContain("non-tail");
  expect(fleetEntry).toContain("non-integer");
  expect(fleetEntry).toContain("oversized");
});


// Walks the lexer tokens and returns each depth-2 release with its depth-3 subsections and
// list entries, in the order they appear in the file.
function releaseSections(markdown: string) {
  const releases: { title: string; subsections: string[]; entries: string[] }[] = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth === 2) {
      releases.push({ title: token.text, subsections: [], entries: [] });
    } else if (releases.length > 0 && token.type === "heading" && token.depth === 3) {
      releases[releases.length - 1].subsections.push(token.text);
    } else if (releases.length > 0 && token.type === "list") {
      for (const item of token.items) releases[releases.length - 1].entries.push(item.raw);
    }
  }
  return releases;
}

test("Original PR 794: two successive releases keep their headings, subsections and entries in source order", () => {
  const published = readFileSync(join(root, "packages/site/src/data/CHANGELOG.md"), "utf8");
  const releases = releaseSections(published);
  const newer = releases.findIndex((release) => release.title === "0.3.0 (2026-10-31)");
  expect(newer).toBeGreaterThanOrEqual(0);
  // 0.2.2 is the very next release heading after 0.3.0.
  expect(releases[newer + 1]?.title).toBe("0.2.2 (2026-10-25)");
  const [first, second] = releases.slice(newer, newer + 2);

  expect(first.subsections.slice(0, 3)).toEqual(["Added", "Changed and fixed", "Compatibility notes"]);
  expect(second.subsections.slice(0, 3)).toEqual(["Changed", "Added", "Templates"]);
  expect(first.entries[0]).toStartWith("- Fleet diagnostics: lanes, supply");
  expect(second.entries[0]).toStartWith("- Release: npm publishing relies only on npm trusted publishing");

  // Every entry appears in the file after the previous one, and each release's entries
  // all fall between its own heading and the next release heading.
  const bounds = [
    published.indexOf("\n## 0.3.0 (2026-10-31)\n"),
    published.indexOf("\n## 0.2.2 (2026-10-25)\n"),
    published.indexOf("\n## 0.2.1 (2026-10-16)\n"),
  ];
  expect(bounds[0]).toBeGreaterThanOrEqual(0);
  expect(bounds[0]).toBeLessThan(bounds[1]);
  expect(bounds[1]).toBeLessThan(bounds[2]);
  [first, second].forEach((release, index) => {
    let cursor = bounds[index];
    expect(release.entries.length).toBeGreaterThan(0);
    for (const entry of release.entries) {
      const position = published.indexOf(entry.trimEnd(), cursor);
      expect(position, entry.slice(0, 60)).toBeGreaterThan(cursor);
      expect(position).toBeLessThan(bounds[index + 1]);
      cursor = position;
    }
  });
});
