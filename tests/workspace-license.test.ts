import { expect, test } from "bun:test";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

async function readManifest(path: string): Promise<{ name?: string; license?: string }> {
  return JSON.parse(await readFile(path, "utf8"));
}

test("every workspace package uses the root license", async () => {
  const rootPkg = await readManifest(join(root, "package.json"));
  expect(typeof rootPkg.license).toBe("string");
  expect(rootPkg.license!.length).toBeGreaterThan(0);

  const entries = await readdir(join(root, "packages"), { withFileTypes: true });
  const packageDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  expect(packageDirs.length).toBeGreaterThan(0);

  for (const dir of packageDirs) {
    const manifestPath = join(root, "packages", dir, "package.json");
    try {
      await access(manifestPath);
    } catch {
      continue; // not a package directory (e.g. packages/plugin)
    }
    const pkg = await readManifest(manifestPath);
    expect(pkg.license, `packages/${dir} license should equal root license`).toBe(rootPkg.license);
  }
});
