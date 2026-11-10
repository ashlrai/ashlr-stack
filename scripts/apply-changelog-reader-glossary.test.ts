import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const guide = read("docs/apply-changelog-reader-glossary.md");

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
  const section = source.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
  const fix = section?.split("\n").find((line) =>
    line.startsWith("- **`stack apply` stops attempting to write placeholder secrets.**"),
  );
  expect(fix).toBeDefined();
  return fix ?? "";
}

describe("apply changelog reader glossary", () => {
  test("glossary terms are unique", () => {
    expect(duplicateTerms(guide)).toEqual([]);
    expect(duplicateTerms("| Term | Meaning in these notes |\n| --- | --- |\n| `Example` | One |\n| example | Two |")).toEqual(["example"]);
  });

  test("glossary entries for present and missing are distinct", () => {
    const entries = glossaryEntries(guide);
    const present = entries.get("present");
    const missing = entries.get("missing");
    expect(present).toBeTruthy();
    expect(missing).toBeTruthy();
    expect(present).not.toBe(missing);
  });

  test("links both source files and their matching historical fix", () => {
    for (const path of paths) {
      expect(guide).toContain(`](../${path})`);
      expect(guide).toContain(`](../${path}#021-2026-10-16)`);
    }
    const [repository, site] = paths.map(read);
    expect(historicalFix(repository)).toBe(historicalFix(site));
    const unreleased = (source: string) => source.split("## Unreleased\n")[1]?.split("\n## ")[0];
    expect(unreleased(repository)).toContain("- `stack apply` does not create placeholder secrets.");
    expect(unreleased(repository)).toBe(unreleased(site));
  });

  test("covers the source terminology and the limits of the report", () => {
    const source = historicalFix(read(paths[0]));
    for (const term of ["TODO_STACK_APPLY", "envelopes", "present", "missing", "skipped"]) {
      expect(source).toContain(term);
      expect(guide).toContain(`\`${term}\``);
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
      expect(guide).toContain(detail);
    }
  });
});
