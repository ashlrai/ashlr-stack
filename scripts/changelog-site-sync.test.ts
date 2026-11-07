import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const guide = readFileSync(join(root, "docs/changelog-site-sync.md"), "utf8");
const commands = [...guide.matchAll(/```sh\n\s*([^\n]+)\n\s*```/g)].map((match) => match[1]);

test("guide links the source and the copy used by the site", () => {
  expect(guide).toContain("](../CHANGELOG.md)");
  expect(guide).toContain("](../packages/site/src/data/CHANGELOG.md)");
  const sitePackage = JSON.parse(readFileSync(join(root, "packages/site/package.json"), "utf8"));
  expect(sitePackage.scripts["sync-content"]).toContain("cp -f ../../CHANGELOG.md src/data/CHANGELOG.md");
  for (const script of ["dev", "start", "build"]) {
    expect(sitePackage.scripts[script]).toContain("sync-content");
  }
  expect(readFileSync(join(root, "packages/site/src/pages/docs/changelog.astro"), "utf8")).toContain(
    '../../data/CHANGELOG.md?raw',
  );
});

test("documented search and comparison distinguish matching, changed and missing copies", () => {
  expect(commands).toHaveLength(4);
  const dir = mkdtempSync(join(tmpdir(), "changelog-site-sync-"));
  try {
    const siteDir = join(dir, "packages/site/src/data");
    mkdirSync(siteDir, { recursive: true });
    const source = readFileSync(join(root, "CHANGELOG.md"), "utf8");
    const sitePath = join(siteDir, "CHANGELOG.md");
    const run = (command: string) => spawnSync("sh", ["-c", command], { cwd: dir, encoding: "utf8" });
    writeFileSync(join(dir, "CHANGELOG.md"), source);
    writeFileSync(sitePath, source);

    const matches = run(commands[0]);
    expect(matches.status).toBe(0);
    expect(matches.stdout.split("\n").filter(Boolean)).toHaveLength(2);
    expect(matches.stdout).toContain("CHANGELOG.md:");
    expect(matches.stdout).toContain("packages/site/src/data/CHANGELOG.md:");
    expect(run(commands[1]).status).toBe(0);

    writeFileSync(sitePath, `${source}\nSite-only note.\n`);
    const diff = run(commands[1]);
    expect(diff.status).toBe(1);
    expect(diff.stdout).toContain("+Site-only note.");
    rmSync(sitePath);
    expect(run(commands[1]).status).toBeGreaterThan(1);
    expect(run(commands[0]).stdout.split("\n").filter(Boolean)).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
