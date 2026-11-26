import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("upgrade questions identify the historical marker as unusable and never written", () => {
  const doc = readFileSync(join(import.meta.dir, "../docs/apply-placeholder-upgrade-questions.md"), "utf8").replace(
    /\s+/g,
    " ",
  );
  expect(doc).toMatch(/`TODO_STACK_APPLY` was a marker, not a usable credential/);
  expect(doc).toMatch(/tried to write it for each declared secret, but every attempt failed/);
  expect(doc).toContain("those attempts wrote no placeholder");
});
