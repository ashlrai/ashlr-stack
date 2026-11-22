import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const guide = read("docs/apply-changelog-maintenance.md");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];

test("maintenance guide identifies both copies and the historical apply sections", () => {
  expect(guide).toContain("](../CHANGELOG.md)");
  expect(guide).toContain("](../packages/site/src/data/CHANGELOG.md)");
  expect(guide).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  expect(guide).toContain("bun run --cwd packages/site sync-content");
  expect(guide).toContain("packages/site/tests/changelog.test.ts scripts/apply-changelog.test.ts");

  for (const path of paths) {
    const changelog = read(path);
    let previousHeading = -1;
    for (const [release, markers] of [
      ["Unreleased", ["including providers that failed"]],
      ["0.3.0 (2026-10-31)", ["Apply wiring", "phantom-wire skipped"]],
      ["0.2.2 (2026-10-25)", ["missing recipe writes nothing", "keep going after a provider fails"]],
      ["0.2.1 (2026-10-16)", ["stops attempting to write placeholder secrets", "every call failed"]],
      ["0.1.0 — 2026-04-19 (superseded by 0.1.1)", ["`stack apply [recipe-id]`", "TODO_STACK_APPLY"]],
    ] as const) {
      const heading = changelog.indexOf(`## ${release}\n`);
      expect(heading).toBeGreaterThan(previousHeading);
      previousHeading = heading;
      const section = changelog.split(`## ${release}\n`)[1]?.split("\n## ")[0];
      expect(section).toBeDefined();
      for (const marker of markers) expect(section).toContain(marker);
      expect(guide).toContain(release.split(" ")[0]);
    }
  }
});

// Folded in from the former docs/apply-changelog-review-checklist.md.
describe("review checklist for the 0.2.1 entry", () => {
  const checklist = guide.split("## Review checklist for the 0.2.1 entry\n")[1] ?? "";
  const title = "`stack apply` stops attempting to write placeholder secrets.";

  test("checklist section exists after the maintenance steps", () => {
    expect(checklist.length).toBeGreaterThan(0);
    expect(guide.indexOf("## Review checklist for the 0.2.1 entry")).toBeGreaterThan(
      guide.indexOf("4. Run `HOME=$(mktemp -d) bun test"),
    );
  });

  test("checklist identifies the corresponding fix in both changelogs", () => {
    expect(checklist).toContain("0.2.1 (2026-10-16) → Bug fixes");
    expect(checklist).toContain(title);
    for (const path of paths) {
      expect(checklist).toContain(`../${path}#021-2026-10-16`);
      const source = read(path);
      const release = source.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
      const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
      const entries = fixes?.split("\n").filter((line) => line.includes(title)) ?? [];
      expect(entries).toHaveLength(1);
      expect(source.split(title)).toHaveLength(2);
    }
  });

  test("checklist prompts comparison of behavior and later qualifications", () => {
    for (const topic of [
      "compare what each says `stack apply` does",
      "provider setup",
      "readable vault",
      "unreadable",
      "`WireResult.envelopes`",
      "Unreleased → Changed",
      "0.3.0 →",
      "including failures",
      "webhook stubs",
      "`--noWire`",
      "before\n  running site build",
      "changelog-mirroring.md#maintainer-rule",
    ]) expect(checklist).toContain(topic);
    // The whole-file diff command lives in step 1 of the procedure above.
    expect(guide).toContain("diff -u CHANGELOG.md packages/site/src/data/CHANGELOG.md");
  });
});
