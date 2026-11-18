import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { EXIT_CODES } from "./exit-codes.ts";

const cli = join(import.meta.dir, "index.ts");

test.each([
  [["completion", "bad"], "Unsupported shell"],
  [["providers", "--category", "bad", "--json"], "category"],
  [["recommend", "--json"], "Provide a query"],
  [["recommend", "hello", "--k", "0", "--json"], "Invalid"],
])("reports failure for %s", (args, message) => {
  const result = spawnSync(process.execPath, [cli, ...args], { timeout: 10_000, encoding: "utf8" });
  expect(result.status).toBe(EXIT_CODES.ERROR);
  expect(result.stdout + result.stderr).toContain(message);
});
