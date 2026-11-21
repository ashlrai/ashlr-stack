import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// docs/changelog-mirroring.md absorbed the former changelog-site-sync,
// changelog-mirror-review and changelog-mirror-checklist guides; their checks
// live here so the merged guide keeps the same guarantees.
const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const guide = read("docs/changelog-mirroring.md");
const rootLog = read("CHANGELOG.md");
const siteLog = read("packages/site/src/data/CHANGELOG.md");
const ENTRY = "`stack apply` does not create placeholder secrets.";
const FIX = "`stack apply` stops attempting to write placeholder secrets.";
const commands = [...guide.matchAll(/```sh\n([^\n]+)\n```/g)].map((match) => match[1]);
const findCommand = (predicate: (command: string) => boolean) => {
  const matches = commands.filter(predicate);
  expect(matches).toHaveLength(1);
  return matches[0];
};
const fixSearch = findCommand((c) => c.startsWith("grep ") && c.includes("stops attempting"));
const entrySearch = findCommand((c) => c.startsWith("grep ") && c.includes("does not create placeholder"));
const compare = findCommand((c) => c.startsWith("diff -u "));

function unreleasedChanged(log: string): string {
  const unreleased = log.split(/^## /m).find((s) => s.startsWith("Unreleased")) ?? "";
  return unreleased.split(/^### /m).find((s) => s.startsWith("Changed")) ?? "";
}

const fixEntry = (text: string) =>
  text
    .split("## 0.2.1 (2026-10-16)\n")[1]
    ?.split("\n## ")[0]
    ?.split("### Bug fixes\n")[1]
    ?.match(/^- \*\*`stack apply` stops attempting to write placeholder secrets\.[\s\S]*?(?=\n- |\n### |$)/m)?.[0];

function withCopies(fn: (dir: string, sitePath: string, run: (c: string) => ReturnType<typeof spawnSync>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "changelog-mirroring-"));
  try {
    const siteDir = join(dir, "packages/site/src/data");
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(join(dir, "CHANGELOG.md"), rootLog);
    writeFileSync(join(siteDir, "CHANGELOG.md"), rootLog);
    fn(dir, join(siteDir, "CHANGELOG.md"), (command) =>
      spawnSync("sh", ["-c", command], { cwd: dir, encoding: "utf8" }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const lines = (out: string | Buffer) => String(out).split("\n").filter(Boolean);

test("guide links both copies and tells maintainers to keep them consistent", () => {
  expect(guide).toContain("](../CHANGELOG.md)");
  expect(guide).toContain("](../packages/site/src/data/CHANGELOG.md)");
  expect(guide).toContain(ENTRY);
  expect(guide).toMatch(/Keep both copies consistent/);
});

test("guide describes the real sync-content script and changelog page", () => {
  const sitePackage = JSON.parse(read("packages/site/package.json"));
  expect(sitePackage.scripts["sync-content"]).toContain("cp -f ../../CHANGELOG.md src/data/CHANGELOG.md");
  expect(sitePackage.scripts["sync-content"]).toContain("|| true");
  for (const script of ["dev", "start", "build"]) {
    expect(sitePackage.scripts[script]).toContain("sync-content");
  }
  expect(read("packages/site/src/pages/docs/changelog.astro")).toContain("../../data/CHANGELOG.md?raw");
});

test("the apply entry appears once in each copy under Unreleased → Changed", () => {
  for (const log of [rootLog, siteLog]) {
    expect(log.split(ENTRY)).toHaveLength(2);
    expect(unreleasedChanged(log)).toContain(ENTRY);
  }
});

test("the documented 0.2.1 fix belongs to the 0.2.1 bug fixes and matches in both copies", () => {
  for (const log of [rootLog, siteLog]) {
    const release = log.split("## 0.2.1 (2026-10-16)\n")[1]?.split("\n## ")[0];
    const fixes = release?.split("### Bug fixes\n")[1]?.split("\n### ")[0];
    expect(fixes).toContain(FIX);
  }
  expect(fixEntry(rootLog)).toBeDefined();
  expect(fixEntry(siteLog)).toBe(fixEntry(rootLog));
  // Scoped comparison: an unrelated note does not change the entry, a reworded entry does.
  expect(fixEntry(`${siteLog}\nUnrelated site note.\n`)).toBe(fixEntry(rootLog));
  expect(fixEntry(siteLog.replace("The wiring step never writes", "The wiring step writes"))).not.toBe(
    fixEntry(rootLog),
  );
});

test("both copies match byte for byte", () => {
  expect(siteLog).toBe(rootLog);
});

test("documented searches and comparison distinguish matching, changed and missing copies", () => {
  withCopies((_dir, sitePath, run) => {
    for (const search of [fixSearch, entrySearch]) {
      const matches = run(search);
      expect(matches.status).toBe(0);
      expect(lines(matches.stdout)).toHaveLength(2);
      expect(String(matches.stdout)).toContain("CHANGELOG.md:");
      expect(String(matches.stdout)).toContain("packages/site/src/data/CHANGELOG.md:");
    }
    expect(run(compare).status).toBe(0);

    writeFileSync(sitePath, `${rootLog}\nSite-only note.\n`);
    const diff = run(compare);
    expect(diff.status).toBe(1);
    expect(String(diff.stdout)).toContain("+Site-only note.");
    expect(lines(run(fixSearch).stdout)).toHaveLength(2);

    rmSync(sitePath);
    expect(run(compare).status).toBeGreaterThan(1);
    // A match in just one file is not enough to establish that both contain it.
    expect(lines(run(fixSearch).stdout)).toHaveLength(1);
  });
});
