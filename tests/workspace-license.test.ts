import { expect, test } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

type Manifest = { name?: string; license?: unknown };

async function readManifest(path: string): Promise<Manifest> {
  return JSON.parse(await readFile(path, "utf8"));
}

/** A license declaration is valid only when it is a string with non-whitespace content. */
function hasNonemptyLicense(pkg: Manifest): boolean {
  return typeof pkg.license === "string" && pkg.license.trim().length > 0;
}

async function workspaceManifests(): Promise<{ dir: string; pkg: Manifest }[]> {
  const entries = await readdir(join(root, "packages"), { withFileTypes: true });
  const packageDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  expect(packageDirs.length).toBeGreaterThan(0);

  const out: { dir: string; pkg: Manifest }[] = [];
  for (const dir of packageDirs) {
    const manifestPath = join(root, "packages", dir, "package.json");
    try {
      await access(manifestPath);
    } catch {
      continue; // not a package directory (e.g. packages/plugin)
    }
    out.push({ dir, pkg: await readManifest(manifestPath) });
  }
  return out;
}

test("hasNonemptyLicense rejects missing, empty, blank and non-string values", () => {
  expect(hasNonemptyLicense({})).toBe(false);
  expect(hasNonemptyLicense({ license: "" })).toBe(false);
  expect(hasNonemptyLicense({ license: "   " })).toBe(false);
  expect(hasNonemptyLicense({ license: null })).toBe(false);
  expect(hasNonemptyLicense({ license: { type: "MIT" } })).toBe(false);
  expect(hasNonemptyLicense({ license: "MIT" })).toBe(true);
});

test("every workspace package declares a nonempty license", async () => {
  const manifests = await workspaceManifests();
  expect(manifests.length).toBeGreaterThan(0);
  for (const { dir, pkg } of manifests) {
    expect(hasNonemptyLicense(pkg), `packages/${dir} must declare a nonempty license`).toBe(true);
  }
});

test("every workspace package uses the root license", async () => {
  const rootPkg = await readManifest(join(root, "package.json"));
  expect(hasNonemptyLicense(rootPkg)).toBe(true);

  for (const { dir, pkg } of await workspaceManifests()) {
    expect(pkg.license, `packages/${dir} license should equal root license`).toBe(rootPkg.license);
  }
});
