import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("the original stack apply entry describes the end of placeholder writes", () => {
  const changelog = readFileSync(join(import.meta.dir, "..", "CHANGELOG.md"), "utf8");
  const release = changelog.split("## 0.1.0 — 2026-04-19 (superseded by 0.1.1)\n")[1]?.split("\n## ")[0];
  const entries = release?.split("\n").filter((line) => line.startsWith("- **`stack apply [recipe-id]`**")) ?? [];

  expect(entries).toHaveLength(1);
  const entry = entries[0];
  expect(entry).toContain("Historically, wiring attempted to write a `TODO_STACK_APPLY` placeholder");
  expect(entry).toContain("those calls failed; the 0.2.1 fix above removed the attempts");
  expect(entry).toContain(
    "Wiring no longer attempts to write placeholder values; it does not write to the vault or fill in missing values.",
  );
  expect(entry).toContain("Provider setup may already store real values");
  expect(entry).toContain("run `phantom add <NAME>` from a trusted terminal and enter the real value");
});
