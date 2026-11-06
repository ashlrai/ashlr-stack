import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sectionEntries } from "./changelog-parser-utils";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const fixture = read("./__fixtures__/changelog-real-colon-entry.md");
const entries = sectionEntries(fixture)[0].entries;

test("fixture entries are verbatim lines of the real CHANGELOG.md", () => {
  const lines = new Set(read("../CHANGELOG.md").split("\n"));
  for (const entry of entries) expect(lines.has(`- ${entry}`)).toBe(true);
});

test("colon entry keeps the colon and the full rest of the entry", () => {
  expect(entries).toHaveLength(2);
  const [colon, plain] = entries;
  const at = colon.indexOf(":");
  expect(colon.slice(0, at)).toBe("Fleet diagnostics");
  // Everything after the first colon survives, including commas and the closing note.
  expect(colon.slice(at)).toStartWith(": lanes, supply, latency, lag, waste, reds,");
  expect(colon).toContain("with grouped `stack fleet` routes.");
  expect(colon).toEndWith("do not establish automatic repair or fleet deployment.");
  // The colon does not split the entry or leak into the next one.
  expect(plain).toStartWith("`stack doctor --repos`");
});
