import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/apply-wiring-history.md");
const doc = readFileSync(docPath, "utf8");
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");

test("wiring history agrees with the changelog about the attempted command and fix", () => {
  const fix = changelog.split("## 0.2.1 (2026-10-16)")[1]?.split("\n## ")[0];
  expect(fix).toBeDefined();
  for (const detail of [
    "`phantom add <KEY> TODO_STACK_APPLY --rotate`",
    "`WireResult.envelopes`",
    "`present` and `missing`",
  ]) {
    expect(fix).toContain(detail);
    expect(doc).toContain(detail);
  }
  expect(fix).toContain("every call failed");
  expect(doc).toContain("Both attempts failed");
  expect(changelog).toContain("0.2.1 was tagged but its npm publish failed");
  expect(doc).toContain("not published to npm");
});

test("historical marker is not presented as a usable credential", () => {
  expect(doc).toContain("do not run it");
  expect(doc).toContain("not a usable");
  expect(doc).toContain("do not store it as a secret");
  expect(doc).toContain("`phantom add <NAME>` in a trusted terminal");
  for (const block of doc.matchAll(/```[\s\S]*?```/g)) {
    expect(block[0]).not.toContain("TODO_STACK_APPLY");
  }
});

test("relative references and changelog headings exist", () => {
  const headings = [...changelog.matchAll(/^#+ (.+)$/gm)].map((match) =>
    match[1].toLowerCase().replace(/[^\w\s-]/g, "").replace(/ /g, "-"),
  );
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    const [target, fragment] = match[1].split("#");
    const path = resolve(dirname(docPath), target);
    expect(existsSync(path), `broken link: ${match[1]}`).toBe(true);
    if (fragment && path === join(root, "CHANGELOG.md")) {
      expect(headings).toContain(fragment);
    }
  }
});
