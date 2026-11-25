import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

for (const path of [
  "docs/changelog-placeholder-timeline.md",
  "CHANGELOG.md",
  "packages/site/src/data/CHANGELOG.md",
]) {
  test(`${path} places the historical retry without --rotate after the first attempt`, () => {
    // Flatten the timeline's wrapped blockquote as well as ordinary prose.
    const text = readFileSync(join(root, path), "utf8").replace(/^> ?/gm, "").replace(/\s+/g, " ");
    const firstAttempt = "Previously, wiring ran `phantom add <KEY> TODO_STACK_APPLY --rotate`";
    const retry = "(then without `--rotate`)";
    const firstAttemptAt = text.indexOf(firstAttempt);
    const retryAt = text.indexOf(retry);

    expect(firstAttemptAt, "missing historical first attempt").toBeGreaterThanOrEqual(0);
    expect(retryAt, "missing historical retry").toBeGreaterThanOrEqual(0);
    expect(retryAt, "retry must follow the first attempt").toBeGreaterThan(firstAttemptAt);
    expect(text.slice(firstAttemptAt + firstAttempt.length, retryAt).trim()).toBe("");
  });
}
