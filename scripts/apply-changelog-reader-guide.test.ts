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
});
