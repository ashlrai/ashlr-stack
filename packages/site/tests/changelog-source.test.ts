import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");

/** Line index of the `## <version>` heading, or -1 when absent. */
function headingLine(markdown: string, version: string): number {
  const escaped = version.replace(/\./g, "\\.");
  const re = new RegExp(`^## \\[?${escaped}\\]?(?:\\s|$)`);
  return markdown.split(/\r?\n/).findIndex((line) => re.test(line));
}

test("0.1.1 appears before 0.1.0 in the site changelog source", () => {
  const newer = headingLine(source, "0.1.1");
  const older = headingLine(source, "0.1.0");
  expect(newer).toBeGreaterThanOrEqual(0);
  expect(older).toBeGreaterThanOrEqual(0);
  expect(newer).toBeLessThan(older);
});

test("the check fails when the entries are reversed", () => {
  const reversed = "## 0.1.0\n\n- a\n\n## 0.1.1\n\n- b\n";
  expect(headingLine(reversed, "0.1.1")).toBeGreaterThan(headingLine(reversed, "0.1.0"));
});
