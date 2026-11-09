import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

test("the 0.1.0 site changelog release is labeled as superseded by 0.1.1", () => {
  const source = readFileSync(join(import.meta.dir, "../src/data/CHANGELOG.md"), "utf8");
  const releases = marked.lexer(source).filter(
    (token) => token.type === "heading" && token.depth === 2 && /^0\.1\.0(?:\s|$)/.test(token.text),
  );

  expect(releases).toHaveLength(1);
  expect(releases[0].text).toContain("(superseded by 0.1.1)");
});
