import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const docPath = join(root, "docs/site-changelog-entry-location.md");
const doc = readFileSync(docPath, "utf8");
const paths = ["CHANGELOG.md", "packages/site/src/data/CHANGELOG.md"];
const title = "- **`stack apply` stops attempting to write placeholder secrets.**";

test("the guide identifies the same first 0.2.1 bug fix in both changelogs", () => {
  expect(doc).toContain("0.2.1 (2026-10-16) → Bug fixes");
  expect(doc).toContain(title.slice(2));
  const entries = paths.map((path) => {
    const changelog = readFileSync(join(root, path), "utf8");
    const release = changelog.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
    const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
    expect(fixes?.trimStart().startsWith(title)).toBe(true);
    const entries = changelog.split("\n").filter ( (line) => line.startsWith(title));
    expect(entries).toHaveLength(1);
    return entries[0];
  });
  expect(entries[0]).toBe(entries[1]);
});

test("documented search and diff expose missing and changed copies", () => {
  const commands = [...doc.matchAll(/```sh\n([^\n]+)\n```/g)].map((match) => match[1]);
  expect(commands).toHaveLength(2);
  const dir = mkdtempSync(join(tmpdir(), "site-changelog-location-"));
  try {
    const source = readFileSync(join(root, paths[0]), "utf8");
    mkdirSync(join(dir, dirname(paths[1])), { recursive: true });
    for (const path of paths) writeFileSync(join(dir, path), source);
    const run = (command: string) => spawnSync("sh", ["-c", command], { cwd: dir, encoding: "utf8" });
    const search = run(commands[0]);
    expect(search.status).toBe(0);
    expect(search.stdout.trim().split("\n")).toHaveLength(2);
    expect(run(commands[1]).status).toBe(0);

    writeFileSync(join(dir, paths[1]), source.replace("The wiring step never writes", "The wiring step writes"));
    const diff = run(commands[1]);
    expect(diff.status).toBe(1);
    expect(diff.stdout).toContain("The wiring step writes");
    writeFileSync(join(dir, paths[1]), source.replace(title, "- Removed entry."));
    expect(run(commands[0]).status).toBe(0);
    expect(run(commands[0]).stdout.trim().split("\n")).toHaveLength(1);
    rmSync(join(dir, paths[1]));
    expect(run(commands[1]).status).toBeGreaterThan(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guide links resolve", () => {
  for (const match of doc.matchAll(/\]\(([^)\s]+)\)/g)) {
    expect(existsSync(resolve(dirname(docPath), match[1])), `broken link: ${match[1]}`).toBe(true);
  }
});
