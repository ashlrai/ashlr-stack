import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("root changelog labels the 0.1.0 release as superseded by 0.1.1", () => {
  const source = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  expect(source).toMatch(/^## 0\.1\.0[ \t]+—[ \t]+2026-04-19 \(superseded by 0\.1\.1\)[ \t]*\r?$/m);
});
