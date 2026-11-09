import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("CHANGELOG.md lists 0.1.1 before 0.1.0", () => {
  const source = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const headings = [...source.matchAll(/^## (0\.1\.[01])(?:\s|$)/gm)].map((match) => match[1]);

  expect(headings).toEqual(["0.1.1", "0.1.0"]);
});
