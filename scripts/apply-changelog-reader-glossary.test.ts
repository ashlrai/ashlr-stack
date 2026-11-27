import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-changelog-reader-glossary.md");
const doc = readFileSync(docPath, "utf8");
const flat = doc.replace(/\s+/g, " ");
const sources = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const read = (path: string) => readFileSync(join(root, path), "utf8");
const section = (heading: string) => doc.split(`\n## ${heading}\n`)[1]?.split("\n## ")[0] ?? "";

describe("apply changelog reader glossary", () => {
  test("identifies the placeholder as a dummy value, not a secret name or credential", () => {
    const placeholder = section("The placeholder").replace(/\s+/g, " ");
    expect(placeholder).toContain("The placeholder is `TODO_STACK_APPLY`");
    expect(placeholder).toContain("dummy value");
    expect(placeholder).toContain("not a secret name");
    expect(placeholder).toContain("not a usable credential");
  });

  test("explains that older wiring tried to add it, and that every attempt failed", () => {
    const placeholder = section("The placeholder").replace(/\s+/g, " ");
    expect(placeholder).toContain("Older wiring tried to add it to Phantom");
    expect(placeholder).toContain("phantom add <KEY> TODO_STACK_APPLY --rotate");
    expect(placeholder).toContain("every attempt failed and nothing was stored");
    expect(placeholder).toContain("Current `stack apply` never writes placeholders");
  });

  test("its claims match the 0.2.1 and Unreleased entries in both changelogs", () => {
    const [repository, site] = sources.map(read);
    expect(repository).toBe(site);
    for (const path of sources) {
      const text = read(path);
      expect(text, path).toContain("`stack apply` stops attempting to write placeholder secrets.");
      expect(text, path).toContain("phantom add <KEY> TODO_STACK_APPLY --rotate");
      expect(text, path).toContain("`WireResult.envelopes` is replaced by");
      expect(text, path).toContain("`stack apply` does not create placeholder secrets.");
    }
  });

  test("defines each word it names and points agents at a CLI and typed result", () => {
    for (const term of ["`envelopes`", "`present` / `missing`", "`skipped`", "`--noWire`"]) {
      expect(doc, term).toContain(`| ${term} |`);
    }
    expect(flat).toContain("phantom add <NAME>");
    expect(flat).toContain("stack apply --help");
    expect(flat).toContain("typed `WireResult`");
    expect(flat).toContain("bun test scripts/apply-changelog-reader-glossary.test.ts");
  });

  test("links resolve and the docs index lists the glossary", () => {
    for (const match of doc.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      expect(existsSync(join(dirname(docPath), match[1])), `broken link: ${match[1]}`).toBe(true);
    }
    expect(read("docs/README.md")).toContain("(apply-changelog-reader-glossary.md)");
  });
});
