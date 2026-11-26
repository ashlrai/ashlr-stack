import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-changelog-reader-guide.md");
const doc = readFileSync(docPath, "utf8");
const flat = doc.replace(/\s+/g, " ");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const read = (path: string) => readFileSync(join(root, path), "utf8");
const section = (changelog: string, heading: string) =>
  changelog.split(`## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";
const docSection = (heading: string) => doc.split(`\n## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";

test("the guide links both changelogs and each cited entry exists in both", () => {
  const locations: [string, string, string][] = [
    ["Unreleased", "unreleased", "- `stack apply` does not create placeholder secrets."],
    ["0.3.0 (2026-10-31)", "030-2026-10-31", "- Apply wiring checks existing secret names"],
    ["0.2.2 (2026-10-25)", "022-2026-10-25", "- **`stack apply` with a missing recipe writes nothing.**"],
    [
      "0.2.1 (2026-10-16)",
      "021-2026-10-16",
      "- **`stack apply` stops attempting to write placeholder secrets.**",
    ],
    [
      "0.1.0 — 2026-04-19 (superseded by 0.1.1)",
      "010--2026-04-19-superseded-by-011",
      "- **`stack apply [recipe-id]`**",
    ],
  ];
  for (const [release, fragment, entry] of locations) {
    for (const path of sources) {
      expect(doc, `${release} ${path}`).toContain(`](../${path}#${fragment})`);
      expect(section(read(path), release), `${path}: ${release}`).toContain(entry);
    }
  }
});

test("the changelogs are identical and the guide's claims match the entries", () => {
  const [repository, site] = sources.map(read);
  expect(repository).toBe(site);
  expect(flat).toContain("byte-for-byte identical");
  const unreleased = section(repository, "Unreleased");
  for (const claim of [
    "a missing name does not itself fail apply, while provider failures do",
    "even if the vault is unreadable",
    "`--noWire` skips both checks and stubs",
  ]) {
    expect(unreleased, `entry: ${claim}`).toContain(claim);
    expect(flat, `doc: ${claim}`).toContain(claim);
  }
  expect(flat).toContain("phantom add <NAME>");
  expect(section(repository, "0.2.1 (2026-10-16)")).toContain("### Earlier 0.2.1 notes (2026-10-12)");
});

test("links resolve and the verify commands name real paths", () => {
  for (const match of doc.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    expect(existsSync(join(dirname(docPath), match[1])), `broken link: ${match[1]}`).toBe(true);
  }
  expect(doc).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  expect(existsSync(join(root, "packages/site/tests/changelog.test.ts"))).toBe(true);
});

describe("release by release", () => {
  const timeline = docSection("Release by release");
  const entries = [
    ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "010--2026-04-19-superseded-by-011", "calls failed; the 0.2.1 fix above removed the attempts"],
    ["0.2.1 (2026-10-16)", "021-2026-10-16", "every call failed and the printed `envelopes` count was always 0"],
    ["0.2.2 (2026-10-25)", "022-2026-10-25", "its npm publish failed"],
    ["0.3.0 (2026-10-31)", "030-2026-10-31", "unreadable vaults are reported as skipped, not missing"],
    ["Unreleased", "unreleased", "including providers that failed"],
  ];

  test("links each recorded heading in both changelogs in chronological order", () => {
    expect(timeline).not.toBe("");
    let previous = -1;
    for (const [heading, fragment, evidence] of entries) {
      const row = timeline.split("\n").find((line) => line.startsWith(`| \`${heading}\``));
      expect(row, heading).toBeDefined();
      const position = timeline.indexOf(row ?? "");
      expect(position).toBeGreaterThan(previous);
      previous = position;
      for (const source of sources) {
        expect(row).toContain(`](../${source}#${fragment})`);
        const changelog = read(source);
        const entry = changelog.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
        expect(entry, `${source}: ${heading}`).toBeDefined();
        expect(entry).toContain(evidence);
      }
    }
  });

  test("preserves distinctions needed to interpret apply results", () => {
    for (const phrase of [
      "annotated with later knowledge",
      "every attempt failed",
      "its npm publish failed",
      "unreadable vault yields skipped providers",
      "including failed providers",
      "Missing names alone do not fail apply; provider failures do",
      "`--noWire` skips both checks and stubs",
      "`phantom add <NAME>` in a trusted terminal",
    ]) {
      expect(timeline).toContain(phrase);
    }
  });
});

describe("glossary", () => {
  const glossary = docSection("Glossary");

  function duplicateTerms(source: string): string[] {
    const table = source.split("| Term | Meaning in these notes |\n")[1]?.split("\n\n")[0];
    if (!table) throw new Error("Glossary table not found");
    const terms = table.split("\n").slice(1).map((row) => {
      const term = row.match(/^\|\s*(.*?)\s*\|/)?.[1];
      if (!term) throw new Error(`Invalid glossary row: ${row}`);
      return term.replaceAll("`", "").trim().replace(/\s+/g, " ").toLowerCase();
    });
    return terms.filter((term, index) => terms.indexOf(term) !== index);
  }

  function glossaryEntries(source: string): Map<string, string> {
    const table = source.split("| Term | Meaning in these notes |\n")[1]?.split("\n\n")[0];
    if (!table) throw new Error("Glossary table not found");
    const entries = new Map<string, string>();
    for (const row of table.split("\n").slice(1)) {
      const cells = row.split("|").map((cell) => cell.trim());
      const term = cells[1]?.replaceAll("`", "").trim().replace(/\s+/g, " ").toLowerCase();
      if (!term || cells[2] === undefined) throw new Error(`Invalid glossary row: ${row}`);
      entries.set(term, cells[2]);
    }
    return entries;
  }

  function historicalFix(source: string): string {
    const fix = section(source, "0.2.1 (2026-10-16)")
      .split("\n")
      .find((line) => line.startsWith("- **`stack apply` stops attempting to write placeholder secrets.**"));
    expect(fix).toBeDefined();
    return fix ?? "";
  }

  test("glossary terms are unique", () => {
    expect(duplicateTerms(glossary)).toEqual([]);
    expect(duplicateTerms("| Term | Meaning in these notes |\n| --- | --- |\n| `Example` | One |\n| example | Two |")).toEqual(["example"]);
  });

  test("the placeholder definition identifies TODO_STACK_APPLY as a dummy value", () => {
    const meaning = glossaryEntries(glossary).get("placeholder / todo_stack_apply");
    expect(meaning).toMatch(/^A dummy value\b/);
  });

  test("glossary entries for present and missing are distinct", () => {
    const entries = glossaryEntries(glossary);
    const present = entries.get("present");
    const missing = entries.get("missing");
    expect(present).toBeTruthy();
    expect(missing).toBeTruthy();
    expect(present).not.toBe(missing);
  });

  test("links both source files and their matching historical fix", () => {
    for (const path of sources) {
      expect(doc).toContain(`](../${path})`);
      expect(doc).toContain(`](../${path}#021-2026-10-16)`);
    }
    const [repository, site] = sources.map(read);
    expect(historicalFix(repository)).toBe(historicalFix(site));
    expect(section(repository, "Unreleased")).toContain("- `stack apply` does not create placeholder secrets.");
    expect(section(repository, "Unreleased")).toBe(section(site, "Unreleased"));
  });

  test("covers the source terminology and the limits of the report", () => {
    const source = historicalFix(read(sources[0]));
    for (const term of ["TODO_STACK_APPLY", "envelopes", "present", "missing", "skipped"]) {
      expect(source).toContain(term);
      expect(glossary).toContain(`\`${term}\``);
    }
    for (const detail of [
      "including failed providers",
      "If no provider succeeds, wiring does not run",
      "does not fill in missing values",
      "a shared name can be counted for more than one provider",
      "do not establish that the vault is empty or complete",
      "overwrites an existing file at that path",
      "do not implement signature verification",
      "skips both the vault check and webhook stubs",
      "provider failures do",
    ]) {
      expect(glossary).toContain(detail);
    }
  });
});

// Folded in from the former changelog-apply-reader-guide doc and its test in
// apply-changelog.test.ts, which also checks the two report examples against
// real `stack apply` output.
describe("reading the report", () => {
  const report = docSection("Reading the report");

  test("records the rotate attempt before the retry without it", () => {
    expect(report.replace(/\s+/g, " ")).toContain(
      "For each declared secret it tried `phantom add <KEY> TODO_STACK_APPLY --rotate`, then tried again without `--rotate`.",
    );
  });

  test("identifies both the placeholder command and its retry as past behavior", () => {
    const history = report.trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ");
    const expectPastAttempts = (text: string) => {
      expect(text).toContain("The 0.2.1 entry records what wiring used to do.");
      expect(text).toContain(
        "For each declared secret it tried `phantom add <KEY> TODO_STACK_APPLY --rotate`, then tried again without `--rotate`.",
      );
      expect(text).toContain("so every call failed");
    };

    expectPastAttempts(history);
    // Reject either attempt becoming a current instruction, even when the
    // surrounding historical introduction is still present.
    for (const [past, instruction] of [
      ["it tried `phantom add", "run `phantom add"],
      ["then tried again without", "then try again without"],
    ]) {
      expect(history).toContain(past);
      expect(() => expectPastAttempts(history.replace(past, instruction))).toThrow();
    }
  });

  test("explains the historical apply fix in the 0.2.1 entry's own terms", () => {
    const fixes = section(read("CHANGELOG.md"), "0.2.1 (2026-10-16)").split("### Bug fixes\n")[1]?.split("\n### ")[0];
    const entry = fixes?.trimStart().split("\n")[0] ?? "";
    expect(entry.startsWith("- **`stack apply` stops attempting to write placeholder secrets.**")).toBe(true);
    expect(report).not.toBe("");
    for (const detail of ["phantom add <KEY> TODO_STACK_APPLY --rotate", "every call failed", "`present` and `missing`"]) {
      expect(entry).toContain(detail);
      expect(report).toContain(detail);
    }
    expect(doc).toContain("](../CHANGELOG.md#021-2026-10-16)");
    expect(report).toContain("missing names alone do not fail it");
    expect(report).toContain("`--noWire` skips both the name checks and the stubs");
  });

  test("shows both report examples and never puts a value in arguments", () => {
    expect(report.match(/```text\n/g)).toHaveLength(2);
    expect(report).toContain("(not in Phantom: OPENAI_API_KEY");
    expect(report).toContain("(phantom-wire skipped: openai)");
    expect(report).toContain("`phantom add OPENAI_API_KEY` in a trusted terminal");
    expect(report).toContain("Do not put a secret value in command arguments.");
  });
});

// Folded in from the former apply-changelog-location, apply-changelog-source-index
// and changelog-apply-source-map docs and tests.
describe("exact locations", () => {
  const locations = docSection("Exact locations");
  // [release heading, subheading, bullet opening]
  const rows: [string, string, string][] = [
    ["Unreleased", "Changed", "- `stack apply` does not create placeholder secrets."],
    ["0.3.0 (2026-10-31)", "Changed and fixed", "- Apply wiring checks existing secret names without storing placeholders;"],
    ["0.3.0 (2026-10-31)", "Changed", "- After at least one provider succeeds, `stack apply` wiring checks"],
    ["0.2.1 (2026-10-16)", "Bug fixes", "- **`stack apply` stops attempting to write placeholder secrets.**"],
    ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", "AI recommendation layer", "- **`stack apply [recipe-id]`**"],
  ];
  const releaseOf = (text: string, heading: string) => {
    const found = text.split(/^## /m).find((s) => s.startsWith(`${heading}\n`));
    expect(found, `missing release ${heading}`).toBeDefined();
    return found as string;
  };

  test("lists every row with its release heading, subheading and bullet", () => {
    expect(locations).not.toBe("");
    for (const [heading, sub, bullet] of rows) {
      const row = locations.split("\n").find((line) => line.startsWith(`| \`${heading}\` | \`${sub}\``));
      expect(row, `${heading} / ${sub}`).toBeDefined();
      expect(row).toContain(bullet.replace(/^- /, "").slice(0, 40));
    }
  });

  test("each row names an entry under that subheading in both changelogs", () => {
    for (const source of sources) {
      const text = read(source);
      for (const [heading, sub, bullet] of rows) {
        const release = releaseOf(text, heading);
        expect(release, `${source} ${heading}`).toContain(bullet);
        const before = release.slice(0, release.indexOf(bullet));
        const lastSub = [...before.matchAll(/^### (.*)$/gm)].pop()?.[1] ?? "";
        expect(lastSub.startsWith(sub), `${source}: ${bullet} is under "${lastSub}"`).toBe(true);
      }
    }
  });

  test("the entries sit at the same line in both files", () => {
    const [a, b] = sources.map((s) => read(s).split("\n"));
    for (const [, , bullet] of rows) {
      const at = (lines: string[]) => lines.findIndex((l) => l.startsWith(bullet));
      expect(at(a)).toBeGreaterThan(-1);
      expect(at(a)).toBe(at(b));
    }
    expect(locations).toContain("same line number in both");
  });

  test("the 0.2.1 fix is the first bullet of the first of two Bug fixes headings", () => {
    const entry = rows[3][2];
    for (const source of sources) {
      const text = read(source);
      expect(text.split("\n").filter((line) => line.startsWith(entry))).toHaveLength(1);
      const fixes = section(text, "0.2.1 (2026-10-16)").split("### Bug fixes\n");
      expect(fixes).toHaveLength(3);
      expect(fixes[1].trimStart().startsWith(entry)).toBe(true);
    }
    expect(locations).toContain("`Bug fixes` (the first of two)");
  });

  test("distinguishes the recorded version from npm publication", () => {
    const release = section(read("CHANGELOG.md"), "0.2.2 (2026-10-25)");
    expect(release).toContain("0.2.1 was tagged but its npm publish failed");
    expect(release).toContain("ships everything listed here and under 0.2.1 below");
    expect(locations).toContain("](../CHANGELOG.md#022-2026-10-25)");
    expect(locations).toContain("0.2.1 was tagged but its npm publish failed");
    expect(locations).toContain("0.2.2 includes its changes");
  });
});

describe("upgrading from the old wiring", () => {
  const upgraders = docSection("Upgrading from the old wiring");
  const flatUpgraders = upgraders.replace(/\s+/g, " ");

  test("section links each cited apply entry and the changelog sections support its claims", () => {
    for (const [heading, fragment, evidence] of [
      [
        "0.1.0 — 2026-04-19 (superseded by 0.1.1)",
        "010--2026-04-19-superseded-by-011",
        "attempted to write a `TODO_STACK_APPLY` placeholder",
      ],
      [
        "0.2.1 (2026-10-16)",
        "021-2026-10-16",
        "`stack apply` stops attempting to write placeholder secrets",
      ],
      ["0.2.2 (2026-10-25)", "022-2026-10-25", "its npm publish failed"],
      [
        "0.3.0 (2026-10-31)",
        "030-2026-10-31",
        "not proof that every required secret is present",
      ],
      ["Unreleased", "unreleased", "including providers that failed"],
    ] as const) {
      expect(upgraders, `link to ${heading}`).toContain(`](../CHANGELOG.md#${fragment})`);
      for (const source of sources) {
        const entry = section(read(source), heading);
        expect(entry, `${source}: ${heading}`).toBeDefined();
        expect(entry, `${source}: ${heading}`).toContain(evidence);
      }
    }
  });

  test("section states the previous and current documented behavior accurately", () => {
    for (const phrase of [
      "previous `stack apply` wiring",
      "`phantom add <KEY> TODO_STACK_APPLY --rotate`",
      "refuses values in command arguments",
      "always 0",
      "never writes to the vault or fills missing values",
      "`WireResult.envelopes` is replaced by `present` and `missing`",
      "`skipped` instead of identifying missing names",
      "`phantom add <NAME>` in a trusted terminal",
      "names alone do not make apply fail",
      "provider failures do",
      "webhook stubs even when the vault is unreadable",
      "both checks and stubs",
      "npm publish failed",
    ]) {
      expect(flatUpgraders).toContain(phrase);
    }
  });

  test("historical commands stay in code spans and the section is scoped to source releases", () => {
    const all = doc.match(/TODO_STACK_APPLY/g) ?? [];
    const codified = doc.match(/`[^`]*TODO_STACK_APPLY[^`]*`/g) ?? [];
    expect(codified.length).toBe(all.length);
    for (const phrase of [
      "historical, not instructions to run",
      "not the version installed",
      "`stack apply --help`",
    ]) {
      expect(flatUpgraders).toContain(phrase);
    }
    expect(upgraders).toContain("](#reading-the-report)");
    expect(doc).toContain("\n## Reading the report\n");
    expect(existsSync(join(root, "docs/apply-upgrade-check.md"))).toBe(true);
  });

  // Folded in from the former docs/changelog-apply-context.md and its test.
  const FIX_ENTRY = "- **`stack apply` stops attempting to write placeholder secrets.**";
  const ORIG_ENTRY = "- **`stack apply [recipe-id]`**";
  const placeholderEntries = (changelog: string): [string, string] => {
    const fix = section(changelog, "0.2.1 (2026-10-16)")
      .split("\n")
      .filter((line) => line.startsWith(FIX_ENTRY));
    const original = section(changelog, "0.1.0 — 2026-04-19 (superseded by 0.1.1)")
      .split("\n")
      .filter((line) => line.startsWith(ORIG_ENTRY));
    expect(fix).toHaveLength(1);
    expect(original).toHaveLength(1);
    return [fix[0], original[0]];
  };

  test("section explains why the historical placeholder wording stays", () => {
    for (const claim of [
      "That behavior is historical",
      "every call failed",
      "they do not happen today",
      "do not run them",
      "a placeholder is not a credential and can block a real value under the same name",
      "](../CHANGELOG.md#021-2026-10-16)",
      "](../CHANGELOG.md#010--2026-04-19-superseded-by-011)",
      "`stack apply [recipe-id]`",
    ]) {
      expect(flatUpgraders).toContain(claim);
    }
    expect(read("AGENTS.md")).toContain("\n## Changelog\n");
  });

  test("both changelogs record the same two placeholder entries", () => {
    const changelogs = sources.map(read);
    const [rootFix, rootOriginal] = placeholderEntries(changelogs[0]);
    const [siteFix, siteOriginal] = placeholderEntries(changelogs[1]);
    expect(siteFix).toBe(rootFix);
    expect(siteOriginal).toBe(rootOriginal);
    for (const entry of [rootFix, rootOriginal]) {
      expect(entry).toContain("TODO_STACK_APPLY");
      expect(entry).toContain("failed");
    }
    expect(rootFix).toContain("The wiring step never writes to the vault or fills in missing values.");
    expect(rootOriginal).toContain("Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder");
    // Each copy names TODO_STACK_APPLY on exactly those two lines, as Verify says.
    for (const changelog of changelogs) {
      expect(changelog.split("\n").filter((line) => line.includes("TODO_STACK_APPLY"))).toHaveLength(2);
    }

    // Losing either entry in either copy must break detection.
    for (const index of [0, 1] as const) {
      for (const entry of [FIX_ENTRY, ORIG_ENTRY]) {
        const changed = changelogs[index].replace(entry, "- **mutated entry.**");
        expect(() => placeholderEntries(changed)).toThrow();
        expect(() => placeholderEntries(changelogs[index === 0 ? 1 : 0])).not.toThrow();
      }
    }
  });
});

describe("term citations by entry", () => {
  const rawIndex = docSection("Term citations by entry");
  const index = rawIndex.replace(/\s+/g, " ");

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
    const sub = releaseSection.split(`### ${subsection}\n`)[1]?.split("\n### ")[0] ?? "";
    const lines = sub.split("\n");
    const start = lines.findIndex((line) => line.startsWith(`- ${lead}`));
    expect(start, `entry not found: ${lead}`).toBeGreaterThanOrEqual(0);
    let text = lines[start];
    for (let i = start + 1; i < lines.length && !lines[i].startsWith("- "); i++) {
      text += `\n${lines[i]}`;
    }
    return text;
  }

  const copies = sources.map(read);
  const entryByLabel = new Map(
    ENTRIES.map(([label, release, subsection, lead]) => [
      label,
      entryText(copies[0], release, subsection, lead),
    ]),
  );

  // [first cell of the terms row, needles every cited entry must contain,
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

  /** The terms table row (in this section) whose first cell is `cell`, as its cells. */
  function termRow(cell: string): string[] {
    const row = rawIndex.split("\n").find((line) => line.startsWith(`| ${cell} |`));
    expect(row, `terms row not found: ${cell}`).toBeDefined();
    return (row as string)
      .split("|")
      .slice(1, -1)
      .map((part) => part.trim());
  }

  test("each citation label resolves to the same apply entry in both changelogs", () => {
    expect(rawIndex.length).toBeGreaterThan(0);
    expect(copies[0]).toBe(copies[1]);
    for (const [label, release, subsection, lead, anchor] of ENTRIES) {
      expect(index).toContain(`](../CHANGELOG.md#${anchor})`);
      expect(index).toContain(`](../packages/site/src/data/CHANGELOG.md#${anchor})`);
      expect(index).toContain(label);
      expect(index).toContain(lead.replace(/\s+/g, " "));
      for (const copy of copies) {
        expect(entryText(copy, release, subsection, lead)).toBe(entryByLabel.get(label));
      }
    }
  });

  test("each term cites exactly the entries that use it", () => {
    for (const [cell, needles, labels, exhaustive] of TERMS) {
      const cells = termRow(cell);
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
      expect(cited.has(label), `no term cites ${label}`).toBe(true);
    }
  });
});

// Folded in from the former apply-changelog-reader-faq doc and test.
const heading = "- **`stack apply` stops attempting to write placeholder secrets.**";

test("the fix is where the guide says it is: first bullet of 0.2.1's first Bug fixes", () => {
  for (const path of sources) {
    const release = section(read(path), "0.2.1 (2026-10-16)");
    // The release has a second Bug fixes heading under the earlier notes.
    expect(release, path).toContain("### Earlier 0.2.1 notes (2026-10-12)");
    expect(release.split("### Bug fixes\n").length, path).toBeGreaterThanOrEqual(3);
    expect(release.split("### Bug fixes\n")[1]?.trimStart().startsWith(heading), path).toBe(
      true,
    );
    expect(
      release.split("\n").filter((line) => line.startsWith(heading)),
      path,
    ).toHaveLength(1);
  }
  expect(flat).toContain("first bullet under the first **Bug fixes** heading");
  expect(flat).toContain("second **Bug fixes** heading");
});

test("the upgrade notes only repeat claims the entry makes", () => {
  const [repository, site] = sources.map(read);
  expect(repository).toBe(site);
  const entry = repository.split("\n").find((line) => line.startsWith(heading));
  expect(entry).toBeDefined();
  for (const claim of [
    "never writes to the vault or fills in missing values",
    "phantom add <KEY> TODO_STACK_APPLY --rotate",
    "has no `--rotate`",
    "envelopes` count was always 0",
    "`WireResult.envelopes` is replaced by `present` and `missing`",
    "phantom add <NAME>` from a trusted terminal",
  ]) {
    expect(entry, `entry: ${claim}`).toContain(claim);
    expect(flat, `doc: ${claim}`).toContain(claim);
  }
});

test("the vault-check details the guide gives come from the fix entry in both sources", () => {
  for (const path of sources) {
    const entry = read(path)
      .split("\n")
      .find((line) => line.startsWith(heading));
    expect(entry, path).toBeDefined();
    for (const claim of [
      "phantom list --json",
      "secrets in vault N · missing M · webhooks K",
      "not in Phantom:",
      "skipped instead of identifying missing names",
    ]) {
      expect(entry, `${path}: ${claim}`).toContain(claim);
      expect(flat, `doc: ${claim}`).toContain(claim);
    }
  }
  expect(flat).toContain(heading.slice(2));
});

test("every restated entry behind the guide exists verbatim in both sources", () => {
  for (const path of sources) {
    const lines = read(path).split("\n");
    for (const firstLine of [
      "- `stack apply` does not create placeholder secrets. After at least one provider succeeds, wiring checks secret names for every provider in the recipe, including providers that failed",
      "- Apply wiring checks existing secret names without storing placeholders; unreadable vaults are reported as skipped, not missing.",
      "- After at least one provider succeeds, `stack apply` wiring checks the recipe's secret names without creating placeholders or filling missing values.",
      "- **`stack apply` with a missing recipe writes nothing.**",
      "- **`stack apply` and `stack init --template` keep going after a provider fails.**",
      "- **`stack apply [recipe-id]`**",
    ]) {
      expect(
        lines.some((line) => line.startsWith(firstLine)),
        `${path}: ${firstLine}`,
      ).toBe(true);
    }
  }
  expect(flat).toContain("`stack init --template` keep going after a provider fails");
  expect(doc).toContain("](site-changelog-review.md#apply-entry-source-map)");
});

test("the original apply description explains that missing values need user action", () => {
  for (const path of sources) {
    const entry = section(read(path), "0.1.0 — 2026-04-19 (superseded by 0.1.1)")
      .split("\n")
      .find((line) => line.startsWith("- **`stack apply [recipe-id]`**"));
    expect(entry, path).toBeDefined();
    expect(entry, path).toContain("does not write to the vault or fill in missing values");
    expect(entry, path).toContain("Users must supply each required missing value");
  }
});

test("the differences section names both files, their roles and the diff check", () => {
  const differences = doc.split("## Do the two changelogs differ?\n")[1]?.split("\n## ")[0];
  expect(differences).toBeDefined();
  for (const claim of [
    "byte-for-byte identical",
    "sync-content",
    "source of truth",
    "diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md",
    "a higher status is an error",
  ]) {
    expect(differences?.replace(/\s+/g, " "), claim).toContain(claim);
  }
  for (const path of sources) {
    expect(differences).toContain(`\`${path}\``);
  }
  expect(doc).toContain("`/docs/changelog`");
});

test("the verify section names the grep check and its expected hits", () => {
  const verify = docSection("Verify");
  expect(verify).toContain("grep -n -F 'stops attempting to write placeholder secrets.'");
  expect(verify).toContain("grep -n -F 'TODO_STACK_APPLY' CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  expect(verify.replace(/\s+/g, " ")).toContain("exactly one hit per file for the first `grep`");
  expect(verify.replace(/\s+/g, " ")).toContain("two per file for the second");
  for (const path of sources) {
    expect(read(path).split("stops attempting to write placeholder secrets.").length - 1, path).toBe(1);
  }
});

// Folded in from the former docs/apply-changelog-maintenance.md.
describe("maintaining these notes", () => {
  const guide = docSection("Maintaining these notes");
  const paths = sources;

  test("maintenance guide identifies both copies and the historical apply sections", () => {
    expect(doc).toContain("](../CHANGELOG.md)");
    expect(doc).toContain("](../packages/site/src/data/CHANGELOG.md)");
    expect(guide).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
    expect(guide).toContain("bun run --cwd packages/site sync-content");
    expect(guide).toContain("packages/site/tests/changelog.test.ts scripts/apply-changelog.test.ts");

    for (const path of paths) {
      const changelog = read(path);
      let previousHeading = -1;
      for (const [release, markers] of [
        ["Unreleased", ["including providers that failed"]],
        ["0.3.0 (2026-10-31)", ["Apply wiring", "phantom-wire skipped"]],
        ["0.2.2 (2026-10-25)", ["missing recipe writes nothing", "keep going after a provider fails"]],
        ["0.2.1 (2026-10-16)", ["stops attempting to write placeholder secrets", "every call failed"]],
        ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", ["`stack apply [recipe-id]`", "TODO_STACK_APPLY"]],
      ] as const) {
        const heading = changelog.indexOf(`## ${release}\n`);
        expect(heading).toBeGreaterThan(previousHeading);
        previousHeading = heading;
        const section = changelog.split(`## ${release}\n`)[1]?.split("\n## ")[0];
        expect(section).toBeDefined();
        for (const marker of markers) expect(section).toContain(marker);
        expect(guide).toContain(release.split(" ")[0]);
      }
    }
  });

  // Folded in from the former docs/apply-changelog-review-checklist.md.
  describe("review checklist for the 0.2.1 entry", () => {
    const checklist = guide.split("### Review checklist for the 0.2.1 entry\n")[1] ?? "";
    const title = "`stack apply` stops attempting to write placeholder secrets.";

    test("checklist section exists after the maintenance steps", () => {
      expect(checklist.length).toBeGreaterThan(0);
      expect(guide.indexOf("### Review checklist for the 0.2.1 entry")).toBeGreaterThan(
        guide.indexOf("4. Run `HOME=$(mktemp -d) bun test"),
      );
    });

    test("checklist identifies the corresponding fix in both changelogs", () => {
      expect(checklist).toContain("0.2.1 (2026-10-16) → Bug fixes");
      expect(checklist).toContain(title);
      for (const path of paths) {
        expect(checklist).toContain(`../${path}#021-2026-10-16`);
        const source = read(path);
        const release = source.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
        const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
        const entries = fixes?.split("\n").filter((line) => line.includes(title)) ?? [];
        expect(entries).toHaveLength(1);
        expect(source.split(title)).toHaveLength(2);
      }
    });

    test("checklist prompts comparison of behavior and later qualifications", () => {
      for (const topic of [
        "compare what each says `stack apply` does",
        "provider setup",
        "readable vault",
        "unreadable",
        "`WireResult.envelopes`",
        "Unreleased → Changed",
        "0.3.0 →",
        "including failures",
        "webhook stubs",
        "`--noWire`",
        "before\n  running site build",
        "changelog-mirroring.md#maintainer-rule",
      ]) expect(checklist).toContain(topic);
      // The whole-file diff command lives in step 1 of the procedure above.
      expect(guide).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
    });
  });
});

// Folded in from the former docs/apply-changelog-comparison.md and its test.
// The comparison now lives in this guide's "Entry-by-entry comparison",
// "Placeholder-wiring language" and "The 0.2.1 fix entry" sections. Names
// declared here shadow the guide-level helpers above on purpose: `sources`
// holds the two changelog texts, not their paths.
describe("root and site comparison", () => {
  const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
  const comparison = doc;
  const sources = paths.map(read);


  // Identify each entry by its release, subsection and opening text. Include the
  // indented examples and sub-bullets so wording changes there are also detected.
  const entries = [
    ["## Unreleased", "### Changed", "- `stack apply` does not create placeholder secrets."],
    ["## 0.3.0 (2026-10-31)", "### Changed and fixed", "- Apply wiring checks existing secret names"],
    ["## 0.3.0 (2026-10-31)", "### Changed", "- After at least one provider succeeds, `stack apply`"],
    ["## 0.2.2 (2026-10-25)", "### Agent-facing output", "- **The last lines of a failing command"],
    ["## 0.2.2 (2026-10-25)", "### Bug fixes", "- **`stack apply` with a missing recipe"],
    ["## 0.2.2 (2026-10-25)", "### Bug fixes", "- **`stack apply` and `stack init --template`"],
    ["## 0.2.1 (2026-10-16)", "### Bug fixes", "- **`stack apply` stops attempting"],
    ["## 0.2.1 (2026-10-16)", "### Hero \"Generate a stack\" demo (from earlier tonight)", "- Clickable in-hero animation"],
    ["## 0.1.0 — 2026-04-19 (superseded by 0.1.1)", "### AI recommendation layer — `stack recommend` + `stack apply`", "- **`stack recommend [query]`**"],
    ["## 0.1.0 — 2026-04-19 (superseded by 0.1.1)", "### AI recommendation layer — `stack recommend` + `stack apply`", "- **`stack apply [recipe-id]`**"],
    ["## 0.1.0 — 2026-04-19 (superseded by 0.1.1)", "### AI recommendation layer — `stack recommend` + `stack apply`", "- **MCP surface**"],
  ] as const;

  function entry(source: string, release: string, section: string, opening: string): string {
    const releaseBody = source.split(`${release}\n`)[1]?.split("\n## ")[0];
    const sectionBody = releaseBody?.split(`${section}\n`)[1]?.split("\n### ")[0];
    const matches = sectionBody?.split(/\n(?=- )/).filter((part) => part.startsWith(opening)) ?? [];
    expect(matches, `${release} / ${section} / ${opening}`).toHaveLength(1);
    return matches[0].trimEnd();
  }

  test("the documented apply entries match in both checked-in changelogs", () => {
    for (const [release, section, opening] of entries) {
      expect(entry(sources[0], release, section, opening)).toBe(entry(sources[1], release, section, opening));
    }
    expect(sources[0]).toBe(sources[1]);
    expect(comparison).toContain("**no wording differences**");
    for (const path of paths) expect(comparison).toContain(`](../${path})`);
    for (const location of ["Unreleased → Changed", "0.3.0 → Changed and fixed", "0.3.0 → Changed", "0.2.2 → Agent-facing output", "0.2.2 → Bug fixes", "0.2.1 → Bug fixes", "0.2.1 → Hero", "0.1.0 → AI recommendation layer"]) {
      expect(comparison).toContain(location);
    }
    expect(comparison).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  });

  test("the entry comparison catches wording changes in examples as well as bullets", () => {
    const changed = sources[1].replace("secrets in vault 0 · missing 1 · webhooks 0", "secrets in vault 0 · missing 2 · webhooks 0");
    const [release, section, opening] = entries[2];
    expect(entry(changed, release, section, opening)).not.toBe(entry(sources[0], release, section, opening));
  });

  const originalApplyLocation = entries[9];
  const noPlaceholderWrites = "Wiring no longer attempts to write placeholder values; it does not write to the vault or fill in missing values.";

  function originalApplyEntriesAgree(source: string, site: string): boolean {
    return source === site && source.includes(noPlaceholderWrites);
  }

  test("both original apply entries say wiring no longer writes placeholder secrets", () => {
    const [source, site] = sources.map((changelog) => entry(changelog, ...originalApplyLocation));
    expect(originalApplyEntriesAgree(source, site)).toBe(true);
  });

  test("original apply consistency rejects drift and matching regressions", () => {
    const original = entry(sources[0], ...originalApplyLocation);
    for (const replacement of ["", "Wiring writes placeholder values to the vault."]) {
      const changed = original.replace(noPlaceholderWrites, replacement);
      expect(changed).not.toBe(original);
      expect(originalApplyEntriesAgree(changed, original)).toBe(false);
      expect(originalApplyEntriesAgree(original, changed)).toBe(false);
      expect(originalApplyEntriesAgree(changed, changed)).toBe(false);
    }
  });

  // Folded in from the former language-comparison doc and test. The report
  // describes the checked-in copies; a site build can overwrite a discrepancy,
  // so compare them directly instead of invoking sync-content.
  describe("placeholder-wiring language", () => {
    const section = (heading: string) => comparison.split(`## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";

    test("language comparison is grounded in both checked-in changelogs", () => {
      const [source, site] = sources;
      const report = section("Placeholder-wiring language");
      expect(site).toBe(source);
      expect(report).toContain("no wording or substantive differences between the two copies");
      expect(comparison).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");

      for (const [heading, markers] of [
        ["Unreleased", ["including providers that failed", "`--noWire` skips both checks and stubs"]],
        ["0.3.0 (2026-10-31)", ["Provider setup may still persist real credentials", "they do not establish that the vault is empty"]],
        ["0.2.1 (2026-10-16)", ["every call failed", "`WireResult.envelopes` is replaced by `present` and `missing`"]],
        ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", ["Missing names alone do not make apply fail", "creates webhook stubs"]],
      ] as const) {
        const release = source.split(`## ${heading}\n`)[1]?.split("\n## ")[0];
        expect(release).toBeDefined();
        for (const marker of markers) expect(release).toContain(marker);
        expect(report).toContain(heading.split(" ")[0]);
      }
    });
  });

  // Folded in from the former source-comparison doc and test.
  describe("the 0.2.1 fix entry", () => {
    const title = "- **`stack apply` stops attempting to write placeholder secrets.**";

    function applyFix(source: string): string {
      const release = source.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
      const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
      const fixEntries = fixes?.split("\n").filter((line) => line.startsWith(title));
      expect(fixEntries).toHaveLength(1);
      expect(fixes?.trimStart().startsWith(title)).toBe(true);
      return fixEntries?.[0] ?? "";
    }

    test("source comparison locates and describes matching apply fix entries", () => {
      const report = comparison.split("## The 0.2.1 fix entry\n")[1]?.split("\n## ")[0] ?? "";
      const fixEntries = paths.map((path, index) => {
        expect(comparison).toContain(`](../${path}#021-2026-10-16)`);
        return applyFix(sources[index]);
      });
      expect(fixEntries[0]).toBe(fixEntries[1]);
      expect(report).toContain("**Substantive wording differences: none.**");
      for (const sourceWording of [
        "Provider setup may already store real values",
        "users must supply each required missing value themselves",
        "reports providers as skipped instead of identifying missing names",
        "every call failed and the printed `envelopes` count was always 0",
        "`WireResult.envelopes` is replaced by `present` and `missing`",
      ]) {
        expect(fixEntries[0]).toContain(sourceWording);
      }
    });

    test("entry comparison detects wording changes in either source", () => {
      const wording = "Provider setup may already store real values";
      for (const index of [0, 1]) {
        const changed = [...sources];
        expect(changed[index]).toContain(wording);
        changed[index] = changed[index].replace(wording, "Provider setup can already store real values");
        expect(applyFix(changed[0])).not.toBe(applyFix(changed[1]));
      }
    });

    // Folded in from the former docs/changelog-apply-comparison.md and its test,
    // which duplicated this section from the changelog side.
    test("fix entry topic table and remaining claims match both changelogs", () => {
      const report = comparison.split("## The 0.2.1 fix entry\n")[1]?.split("\n## ")[0] ?? "";
      const fixEntry = applyFix(sources[0]);
      expect(applyFix(sources[1])).toBe(fixEntry);
      for (const claim of [
        "The wiring step never writes to the vault or fills in missing values.",
        "phantom list --json",
      ]) {
        expect(fixEntry).toContain(claim);
      }
      for (const topic of [
        "Wiring and setup",
        "Required values",
        "Readable vault",
        "Unreadable vault",
        "Previous behavior",
        "Result fields",
      ]) {
        expect(report).toContain(`| ${topic} |`);
      }
      expect(report).toContain("](changelog-mirroring.md#the-021-apply-fix)");
    });

    test("both 0.2.1 fix entries retain the later removal of --rotate", () => {
      expect(applyFix(sources[0])).toBe(applyFix(sources[1]));
      expect(applyFix(sources[0])).toContain(
        "Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`) for every declared secret.",
      );
    });

    test("entry comparison detects a behavior mismatch in either source", () => {
      const behavior = "The wiring step never writes to the vault or fills in missing values.";
      const contradiction = "The wiring step writes placeholder values to the vault.";
      for (const index of [0, 1]) {
        const changed = [...sources];
        expect(changed[index]).toContain(behavior);
        changed[index] = changed[index].replace(behavior, contradiction);
        expect(applyFix(changed[0])).not.toBe(applyFix(changed[1]));
      }
    });
  });

  describe("current and historical apply descriptions", () => {
    const descriptions = [
      { section: "## Unreleased\n", start: "- `stack apply` does not create placeholder secrets." },
      { section: "## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n", start: "- **`stack apply [recipe-id]`**" },
    ];

    function expectApplyDescriptions(changelog: string) {
      for (const { section, start } of descriptions) {
        const release = changelog.split(section)[1]?.split("\n## ")[0];
        expect(release?.split("\n").filter((line) => line.startsWith(start))).toHaveLength(1);
      }
    }

    test("each changelog retains its current and historical apply descriptions", () => {
      for (const changelog of sources) {
        expectApplyDescriptions(changelog);
        for (const { start } of descriptions) {
          const line = changelog.split("\n").find((candidate) => candidate.startsWith(start));
          expect(line).toBeDefined();
          expect(() => expectApplyDescriptions(changelog.replace(line ?? "", ""))).toThrow();
        }
      }
    });
  });

  // Folded in from the former docs/apply-changelog-consistency-check.md, whose
  // table, 0.2.1 cross-reference and diff command duplicated this comparison.
  describe("consistency check", () => {
    test("release markers the comparison summarizes exist in the root changelog", () => {
      for (const [release, markers] of [
        ["0.3.0 (2026-10-31)", ["phantom-wire skipped: openai"]],
        ["0.2.2 (2026-10-25)", ["`stack apply` with a missing recipe writes nothing"]],
        ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", ["`stack_apply` exposed"]],
      ] as const) {
        const section = sources[0].split(`## ${release}\n`)[1]?.split("\n## ")[0];
        expect(section).toBeDefined();
        for (const marker of markers) expect(section).toContain(marker);
      }
    });

    test("comparison locates the 0.2.1 fix as the first Bug fixes bullet", () => {
      const report = comparison.split("## The 0.2.1 fix entry\n")[1]?.split("\n## ")[0] ?? "";
      expect(report).toContain("first bullet under **Bug fixes**");
      expect(report).toContain("“`stack apply` stops attempting to write placeholder\nsecrets.”");
    });
  });
});
