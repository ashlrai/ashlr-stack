import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";

// This glossary absorbed the former apply-terminology-examples.md and
// apply-wiring-terminology.md guides; their checks live here. The JSON examples
// are checked against real wiring in packages/core/src/__tests__/apply-terminology-examples.test.ts.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const guideUrl = new URL("docs/apply-placeholder-terminology.md", root);
const doc = readFileSync(guideUrl, "utf8");
const changelogPaths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const changelogs = changelogPaths.map(read);

// Restrict the mirror comparison to the entries covered by this guide, so an
// unrelated changelog change does not force a terminology review.
function entry(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

// Include inline links and reference definitions; fragments and queries do not
// form part of the local filename. External URLs and fragment-only links are not files.
function relativeFileLinks(markdown: string): string[] {
  const destinations = [
    ...markdown.matchAll(/!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g),
    ...markdown.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm),
  ];
  return destinations
    .map((match) => match[1])
    .filter((target) => !/^(?:[a-z][a-z\d+.-]*:|\/|#|\?)/i.test(target))
    .map((target) => target.split(/[?#]/, 1)[0]);
}

describe("apply placeholder terminology", () => {
  test("the glossary identifies TODO_STACK_APPLY as a historical placeholder", () => {
    const glossary = doc.split("\n## Glossary\n")[1]?.split("\n## ")[0];
    const rows = glossary?.split("\n").filter((line) => /^\|\s*`TODO_STACK_APPLY`\s*\|/.test(line));
    expect(rows).toHaveLength(1);
    const meaning = rows?.[0].split("|")[2];
    expect(meaning).toContain("A literal dummy value that old wiring attempted to add");
    expect(meaning).toContain("not a usable credential or a secret name");
    expect(meaning).toContain("required secrets need real values from their providers");
    expect(meaning).toContain("The calls failed; the placeholder was not successfully stored");
  });

  test("both changelogs record the history and removal described by the glossary", () => {
    for (const changelog of changelogs) {
      const initial = changelog.split("## 0.1.0 — 2026-04-19")[1];
      const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split("\n## ")[0];
      expect(initial).toContain("wiring attempted to write a `TODO_STACK_APPLY` placeholder");
      expect(initial).toContain("those calls failed; the 0.2.1 fix above removed the attempts");
      expect(fix).toContain("phantom add <KEY> TODO_STACK_APPLY --rotate");
      expect(fix).toContain("every call failed");
      expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");
    }
  });

  test("the documented apply entries match in the two checked-in changelogs", () => {
    const boundaries = [
      ["- `stack apply` does not create placeholder secrets.", "\n\n## 0.3.0"],
      ["- Apply wiring checks existing secret names", "\n- MCP compacts"],
      ["- After at least one provider succeeds, `stack apply`", "\n- `stack status`"],
      ["- **`stack apply` with a missing recipe", "\n\n## 0.2.1"],
      ["- **`stack apply` stops attempting to write placeholder secrets.", "\n\n- **Command errors"],
      ["- **`stack apply [recipe-id]`**", "\n- **MCP surface"],
    ];
    const [repository, site] = changelogs;
    for (const [start, end] of boundaries) {
      expect(entry(site, start, end)).toBe(entry(repository, start, end));
    }
  });

  test("the glossary defines the historical value and current inventory terms", () => {
    expect(doc).toContain("A literal dummy value");
    expect(doc).toContain("not a usable credential or a secret name");
    expect(doc).toContain("not successfully stored by those attempts");
    expect(doc).toContain("wiring no longer writes to the vault or fills missing");
    expect(doc).toContain("Skipped does not mean missing or present");
    expect(doc).toContain("`phantom add <NAME>` in a trusted terminal");
    expect(doc).toContain("`--noWire` skips both the inventory");
  });

  test("the glossary covers the source labels and their different scopes", () => {
    for (const label of ["TODO_STACK_APPLY", "envelopes", "present", "missing", "skipped", "webhooks", "--noWire"]) {
      expect(changelogs[0]).toContain(label);
      expect(doc).toContain(`\`${label}\``);
    }
    expect(doc).toContain("including failed providers");
    expect(doc).toContain("does not prove all required secrets are present");
    expect(doc).toContain("no wording differences between their apply entries");
  });

  test("extracts local file destinations without fragments or queries", () => {
    expect(relativeFileLinks("[local](../file.md#section) [web](https://example.com) [section](#part)\n[ref]: other.md?raw=1")).toEqual([
      "../file.md",
      "other.md",
    ]);
  });

  test("the glossary links both changelogs and every relative file link resolves", () => {
    expect(doc).toContain("](../CHANGELOG.md)");
    expect(doc).toContain("](../packages/site/src/data/CHANGELOG.md)");
    const links = relativeFileLinks(doc);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const url = new URL(link, guideUrl);
      expect(statSync(url, { throwIfNoEntry: false })?.isFile(), `Broken relative file link: ${link}`).toBe(true);
    }
  });
});
