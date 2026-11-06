import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const procedure = readFileSync(join(root, "docs/changelog-update-procedure.md"), "utf8");

test("procedure identifies the source and site copy and their actual sync path", () => {
  expect(procedure).toContain("](../CHANGELOG.md)");
  expect(procedure).toContain("](../packages/site/src/data/CHANGELOG.md)");
  const sitePackage = JSON.parse(readFileSync(join(root, "packages/site/package.json"), "utf8"));
  expect(sitePackage.scripts["sync-content"]).toContain("cp -f ../../CHANGELOG.md src/data/CHANGELOG.md");
  for (const script of ["dev", "start", "build"]) {
    expect(sitePackage.scripts[script]).toContain("sync-content");
  }
  expect(readFileSync(join(root, "packages/site/src/pages/docs/changelog.astro"), "utf8")).toContain(
    '../../data/CHANGELOG.md?raw',
  );
});

test("documented comparison detects equal, changed and missing files", () => {
  const command = procedure.match(/```sh\n\s*(diff -u [^\n]+)\n\s*```/)?.[1];
  expect(command).toBeDefined();
  const dir = mkdtempSync(join(tmpdir(), "changelog-update-"));
  try {
    const siteDir = join(dir, "packages/site/src/data");
    mkdirSync(siteDir, { recursive: true });
    const sourcePath = join(dir, "CHANGELOG.md");
    const sitePath = join(siteDir, "CHANGELOG.md");
    writeFileSync(sourcePath, "# Changelog\n\n## Unreleased\n");
    writeFileSync(sitePath, readFileSync(sourcePath));
    const compare = () => spawnSync("sh", ["-c", command ?? ""], { cwd: dir, encoding: "utf8" });
    expect(compare().status).toBe(0);
    writeFileSync(sitePath, "# Changelog\n\n## Unreleased\n\nSite-only note.\n");
    const changed = compare();
    expect(changed.status).toBe(1);
    expect(changed.stdout).toContain("+Site-only note.");
    rmSync(sitePath);
    expect(compare().status).toBeGreaterThan(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
