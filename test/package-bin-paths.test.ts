import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = fileURLToPath(new URL("../packages/", import.meta.url));

type Manifest = {
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
};

// A bin may point at a build output (dist/*), which does not exist in a clean
// checkout such as the Coverage job. It is valid when the file exists, or when
// the package's build script bundles an existing source entry into that exact
// outdir and file name (`bun build src/x.ts --outdir dist`).
function producedByBuild(packageDir: string, manifest: Manifest, binPath: string): boolean {
  const build = manifest.scripts?.build ?? "";
  const match = build.match(/bun build (\S+) --outdir (\S+)/);
  if (!match) return false;
  const [, entry, outdir] = match as unknown as [string, string, string];
  if (!statSync(join(packageDir, entry), { throwIfNoEntry: false })?.isFile()) return false;
  const output = posix.join(outdir, `${basename(entry, extname(entry))}.js`);
  return posix.normalize(binPath) === output;
}

test("package bin entries reference existing files", () => {
  const missing: string[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = join(packagesDir, entry.name);
    const manifestPath = join(packageDir, "package.json");
    if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    const bins = typeof manifest.bin === "string" ? { bin: manifest.bin } : (manifest.bin ?? {});
    for (const [name, path] of Object.entries(bins)) {
      if (statSync(join(packageDir, path), { throwIfNoEntry: false })?.isFile()) continue;
      if (producedByBuild(packageDir, manifest, path)) continue;
      missing.push(`${entry.name} (${name}): ${path}`);
    }
  }
  expect(missing).toEqual([]);
});
