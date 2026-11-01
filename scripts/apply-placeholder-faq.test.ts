import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const faq = readFileSync(new URL("../docs/apply-placeholder-faq.md", import.meta.url), "utf8").replace(
  /\s+/g,
  " ",
);
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

test("the FAQ distinguishes the historical rotation attempt from its result", () => {
  const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split(/^## /m)[0];
  expect(fix).toContain("`phantom add <KEY> TODO_STACK_APPLY --rotate` (then without `--rotate`)");
  expect(fix).toContain("has no `--rotate`, so every call failed");
  expect(fix).toContain("`WireResult.envelopes` is replaced by `present` and `missing`");
  expect(faq).toContain("../CHANGELOG.md#021-2026-10-16");
  expect(faq).toContain("`phantom add <KEY> TODO_STACK_APPLY --rotate`, then retried without `--rotate`");
  expect(faq).toContain("every call failed. The attempted option did not rotate secrets");
  expect(faq).toContain("does not establish the state of an individual vault or prescribe a migration");
  expect(faq).toContain("`WireResult.envelopes` field was replaced by `present` and `missing`");
});
