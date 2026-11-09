import { expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = fileURLToPath(new URL("../packages/", import.meta.url));

type Manifest = {
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
};

function binIsInsidePackage(packageDir: string, binPath: string): boolean {
  if (!binPath || binPath.includes("\\") || binPath.split("/").includes("..") || isAbsolute(binPath) || win32.isAbsolute(binPath)) return false;
  const root = realpathSync(packageDir);
  let target = resolve(root, binPath);
  const withinRoot = (path: string) => {
    const fromRoot = relative(root, path);
    return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
  };
  if (!withinRoot(target)) return false;
  // Build outputs may not exist yet; resolve the closest existing ancestor so
  // a symlinked output directory cannot point outside the package.
  while (!lstatSync(target, { throwIfNoEntry: false })) {
    target = dirname(target);
  }
  try {
    const actual = realpathSync(target);
    return actual === root || withinRoot(actual);
  } catch {
    return false;
  }
}

test("bin path validation rejects absolute paths, traversal, and escaping symlinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "stack-bin-path-"));
  try {
    const packageDir = join(dir, "package");
    mkdirSync(packageDir);
    symlinkSync(dir, join(packageDir, "outside"));
    symlinkSync(join(dir, "missing"), join(packageDir, "dangling"));
    for (const path of ["dist/index.js", "./dist/index.js"]) {
      expect(binIsInsidePackage(packageDir, path)).toBe(true);
    }
    for (const path of ["", ".", "../other.js", "outside/../bin.js", "/tmp/other.js", "C:\\other.js", "outside/bin.js", "dangling"]) {
      expect(binIsInsidePackage(packageDir, path)).toBe(false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("package bin paths are relative and resolve inside their package", () => {
  const invalid: string[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = join(packagesDir, entry.name);
    const manifestPath = join(packageDir, "package.json");
    if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
    const bins = typeof manifest.bin === "string" ? { bin: manifest.bin } : (manifest.bin ?? {});
    for (const [name, path] of Object.entries(bins)) {
      if (!binIsInsidePackage(packageDir, path)) invalid.push(`${entry.name} (${name}): ${path}`);
    }
  }
  expect(invalid).toEqual([]);
});

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

// A bin target must be a regular file. An existing directory, FIFO or other
// non-file entry at the bin path is never valid, even if the build would
// rewrite it; only a path that does not exist yet may fall back to the build.
function binTargetIsFile(packageDir: string, manifest: Manifest, binPath: string): boolean {
  const stat = statSync(join(packageDir, binPath), { throwIfNoEntry: false });
  if (stat) return stat.isFile();
  return producedByBuild(packageDir, manifest, binPath);
}

test("bin target check accepts files and rejects directories and missing paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "stack-bin-file-"));
  try {
    mkdirSync(join(dir, "dist", "isdir.js"), { recursive: true });
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "dist", "cli.js"), "");
    writeFileSync(join(dir, "src", "index.ts"), "");
    symlinkSync(join(dir, "dist", "cli.js"), join(dir, "dist", "link.js"));
    const built: Manifest = { scripts: { build: "bun build src/index.ts --outdir dist" } };
    expect(binTargetIsFile(dir, {}, "dist/cli.js")).toBe(true);
    expect(binTargetIsFile(dir, {}, "dist/link.js")).toBe(true);
    expect(binTargetIsFile(dir, built, "dist/index.js")).toBe(true);
    expect(binTargetIsFile(dir, {}, "dist/index.js")).toBe(false);
    expect(binTargetIsFile(dir, {}, "dist/missing.js")).toBe(false);
    expect(binTargetIsFile(dir, built, "dist/other.js")).toBe(false);
    // Directory is rejected even when the build would produce that name.
    expect(binTargetIsFile(dir, { scripts: { build: "bun build src/isdir.ts --outdir dist" } }, "dist/isdir.js")).toBe(false);
    expect(binTargetIsFile(dir, built, "dist")).toBe(false);
    expect(binTargetIsFile(dir, built, "src")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
      if (!binTargetIsFile(packageDir, manifest, path)) missing.push(`${entry.name} (${name}): ${path}`);
    }
  }
  expect(missing).toEqual([]);
});
