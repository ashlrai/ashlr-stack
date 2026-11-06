import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-changelog-terminology.md");
const rawDoc = readFileSync(docPath, "utf8");
const doc = rawDoc.replace(/\s+/g, " ");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

// [label, `## ` release heading, `### ` subsection, text the entry begins with,
// GitHub anchor for the release heading]
const ENTRIES = [
  ["U", "Unreleased", "Changed", "`stack apply` does not create placeholder secrets.", "unreleased"],
  [
    "0.3.0-CF",
    "0.3.0 (2026-10-31)",
    "Changed and fixed",
    "Apply wiring checks existing secret names without storing placeholders",
    "030-2026-10-31",
  ],
  [
    "0.3.0-C",
    "0.3.0 (2026-10-31)",
    "Changed",
    "After at least one provider succeeds, `stack apply` wiring checks the recipe's secret names",
    "030-2026-10-31",
  ],
  [
    "0.2.2-A",
    "0.2.2 (2026-10-25)",
    "Bug fixes",
    "**`stack apply` with a missing recipe writes nothing.**",
    "022-2026-10-25",
  ],
  [
    "0.2.2-B",
    "0.2.2 (2026-10-25)",
    "Bug fixes",
    "**`stack apply` and `stack init --template` keep going after a provider fails.**",
    "022-2026-10-25",
  ],
  [
    "0.2.1",
    "0.2.1 (2026-10-16)",
    "Bug fixes",
    "**`stack apply` stops attempting to write placeholder secrets.**",
    "021-2026-10-16",
  ],
  [
    "0.1.0",
    "0.1.0 — 2026-04-19 (superseded by 0.1.1)",
    "AI recommendation layer — `stack recommend` + `stack apply`",
    "**`stack apply [recipe-id]`**",
    "010--2026-04-19-superseded-by-011",
  ],
] as const;

const LABELS = ENTRIES.map(([label]) => label);

/** The apply bullet under release → subsection, including indented continuation lines. */
function entryText(changelog: string, release: string, subsection: string, lead: string): string {
  const releaseSection = changelog.split(`## ${release}\n`)[1]?.split("\n## ")[0] ?? "";
  const section = releaseSection.split(`### ${subsection}\n`)[1]?.split("\n### ")[0] ?? "";
  const lines = section.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`- ${lead}`));
  expect(start, `entry not found: ${lead}`).toBeGreaterThanOrEqual(0);
  let text = lines[start];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith("- "); i++) {
    text += `\n${lines[i]}`;
  }
  return text;
}

const copies = paths.map((path) => readFileSync(join(root, path), "utf8"));
const entryByLabel = new Map(
  ENTRIES.map(([label, release, subsection, lead]) => [
    label,
    entryText(copies[0], release, subsection, lead),
  ]),
);

// [first cell of the glossary row, needles every cited entry must contain,
// labels the row must cite, whether the citations must cover every matching entry]
const TERMS: [string, RegExp[], string[], boolean][] = [
  ["Recipe / recipe-id", [/recipe/i], ["U", "0.3.0-C", "0.2.2-A", "0.2.2-B", "0.1.0"], true],
  ["Provider setup", [/provider setup/i], ["0.3.0-CF", "0.3.0-C", "0.2.1", "0.1.0"], true],
  ["`stack add` pipeline", [/`stack add`/], ["0.2.2-B", "0.1.0"], true],
  ["Wiring", [/wiring/i], ["U", "0.3.0-CF", "0.3.0-C", "0.2.1", "0.1.0"], true],
  [
    "Declared secret name",
    [/secret names?|declared secrets?/i],
    ["U", "0.3.0-CF", "0.3.0-C", "0.2.1", "0.1.0"],
    true,
  ],
  [
    "Real value / real credentials",
    [/real (values?|credentials?)/i],
    ["U", "0.3.0-CF", "0.3.0-C", "0.2.1", "0.1.0"],
    true,
  ],
  [
    "Placeholder / placeholder secret",
    [/placeholder/i],
    ["U", "0.3.0-CF", "0.3.0-C", "0.2.1", "0.1.0"],
    true,
  ],
  ["`TODO_STACK_APPLY`", [/TODO_STACK_APPLY/], ["0.2.1", "0.1.0"], true],
  ["`envelopes` / `WireResult.envelopes`", [/envelopes/, /WireResult/], ["0.2.1"], true],
  // "missing" is also used for an absent recipe (0.2.2-A), so the word alone
  // does not identify the wiring classification.
  [
    "`present` / `missing`",
    [/\bpresent\b|\bmissing\b/i],
    ["U", "0.3.0-CF", "0.3.0-C", "0.2.1", "0.1.0"],
    false,
  ],
  ["`skipped`", [/\bskipped\b/i], ["0.3.0-CF", "0.3.0-C", "0.2.1", "0.1.0"], true],
  ["Webhook stub / `webhooks`", [/webhook/i], ["U", "0.3.0-C", "0.2.1", "0.1.0"], true],
  [
    "`secrets in vault` / `not in Phantom:`",
    [/secrets in vault/, /not in Phantom/],
    ["0.3.0-C", "0.2.1"],
    true,
  ],
  [
    "`phantom add <NAME>` / trusted terminal",
    [/phantom add/, /trusted terminal/],
    ["0.3.0-C", "0.2.1", "0.1.0"],
    true,
  ],
  ["`phantom list --json`", [/phantom list/], ["0.2.1"], true],
  ["`--noWire`", [/--noWire/], ["U", "0.3.0-C", "0.1.0"], true],
  [
    "Readable / unreadable vault",
    [/readable|unreadable|cannot (be )?read/i],
    ["U", "0.3.0-CF", "0.3.0-C", "0.2.1", "0.1.0"],
    true,
  ],
  ["Provider failure", [/providers? (fail|failed|failures)/i], ["U", "0.2.2-B", "0.1.0"], true],
  ["`Some providers failed` / exit 1", [/Some providers failed/, /exit 1/], ["0.2.2-B"], true],
  ["Partial-failure rollback", [/rollback/i], ["0.2.2-B"], true],
  ["Missing recipe / auto-`stack init`", [/\.stack\.toml/, /stack init/], ["0.2.2-A"], true],
  ["`@clack/prompts` picker", [/@clack\/prompts/], ["0.1.0"], true],
];

/** The glossary table row whose first cell is `cell`, as its `|`-separated cells. */
function glossaryRow(cell: string): string[] {
  const row = rawDoc.split("\n").find((line) => line.startsWith(`| ${cell} |`));
  expect(row, `glossary row not found: ${cell}`).toBeDefined();
  return (row as string)
    .split("|")
    .slice(1, -1)
    .map((part) => part.trim());
}

test("each citation label resolves to the same apply entry in both changelogs", () => {
  expect(copies[0]).toBe(copies[1]);
  for (const [label, release, subsection, lead, anchor] of ENTRIES) {
    expect(doc).toContain(`](../CHANGELOG.md#${anchor})`);
    expect(doc).toContain(`](../packages/site/src/data/CHANGELOG.md#${anchor})`);
    expect(doc).toContain(label);
    expect(doc).toContain(lead.replace(/\s+/g, " "));
    for (const copy of copies) {
      expect(entryText(copy, release, subsection, lead)).toBe(entryByLabel.get(label));
    }
  }
});

test("each glossary term cites exactly the entries that use it", () => {
  for (const [cell, needles, labels, exhaustive] of TERMS) {
    const cells = glossaryRow(cell);
    const cited = cells.at(-1)?.split(",").map((label) => label.trim());
    expect(cited, `citations for ${cell}`).toEqual(labels);
    for (const label of labels) {
      const text = entryByLabel.get(label) ?? "";
      for (const needle of needles) {
        expect(needle.test(text), `${cell} not found in ${label}`).toBe(true);
      }
    }
    if (exhaustive) {
      const matching = LABELS.filter((label) =>
        needles.every((needle) => needle.test(entryByLabel.get(label) ?? "")),
      );
      expect(matching, `entries using ${cell}`).toEqual(labels);
    }
  }
});

test("the citations cover every apply entry", () => {
  const cited = new Set(TERMS.flatMap(([, , labels]) => labels));
  for (const label of LABELS) {
    expect(cited.has(label), `no glossary term cites ${label}`).toBe(true);
  }
});

test("doc links resolve", () => {
  for (const match of rawDoc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    expect(existsSync(resolve(dirname(docPath), target)), `broken link: ${match[1]}`).toBe(true);
  }
});
