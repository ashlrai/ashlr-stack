import { expect, test } from "bun:test";
import {
  mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = fileURLToPath(new URL("../packages/", import.meta.url));

function invalidLiteralEntries(packageDir: string, files: string[]): string[] {
  const root = realpathSync(packageDir);
  return files.filter((entry) => {
    // Negations and patterns are not explicit file or directory paths.
    if (entry.startsWith("!") || /[*?\[\]{}]/.test(entry) || /[+@!]\(/.test(entry)) return false;
    try {
      const target = realpathSync(resolve(root, entry));
      const pathFromRoot = relative(root, target);
      return (
        pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)
      );
    } catch {
      return true;
    }
  });
}

test("explicit package files exist within their package", () => {
  const invalid: string[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = join(packagesDir, entry.name);
    const manifestPath = join(packageDir, "package.json");
    if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files?: string[] };
    invalid.push(
      ...invalidLiteralEntries(packageDir, manifest.files ?? []).map((path) => `${entry.name}: ${path}`),
    );
  }
  expect(invalid).toEqual([]);
});

test("explicit package file validation detects missing and escaping paths", () => {
  const fixture = mkdtempSync(join(tmpdir(), "stack-package-files-"));
  try {
    const packageDir = join(fixture, "package");
    mkdirSync(join(packageDir, "existing"), { recursive: true });
    writeFileSync(join(packageDir, "existing", "file.txt"), "");
    writeFileSync(join(fixture, "outside.txt"), "");
    symlinkSync(join(fixture, "outside.txt"), join(packageDir, "link"));
    expect(
      invalidLiteralEntries(packageDir, [
        "existing",
        "existing/file.txt",
        "existing/missing.txt",
        "../outside.txt",
        "link",
        "dist/**/*",
        "!excluded",
      ]),
    ).toEqual(["existing/missing.txt", "../outside.txt", "link"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("explicit package file validation handles ./, trailing slash, absolute and dot-dot paths", () => {
  const fixture = mkdtempSync(join(tmpdir(), "stack-package-files-"));
  try {
    const packageDir = join(fixture, "package");
    mkdirSync(join(packageDir, "dir"), { recursive: true });
    writeFileSync(join(packageDir, "dir", "a.txt"), "");
    writeFileSync(join(fixture, "outside.txt"), "");
    expect(
      invalidLiteralEntries(packageDir, [
        "./dir",
        "dir/",
        "dir/../dir/a.txt",
        join(fixture, "outside.txt"),
        "dir/../../outside.txt",
        "src/*.ts",
        "lib/@(a|b)",
      ]),
    ).toEqual([join(fixture, "outside.txt"), "dir/../../outside.txt"]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("package files entries reference existing paths", () => {
  const missing: string[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = join(packagesDir, entry.name);
    const manifestPath = join(packageDir, "package.json");
    if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      files?: string[];
    };
    const files = manifest.files ?? [];
    for (const f of files) {
      if (f.startsWith("dist") || f.startsWith("!")) continue;
      const checkPath = join(packageDir, f);
      const isFile = statSync(checkPath, { throwIfNoEntry: false })?.isFile();
      const isDir = statSync(checkPath, { throwIfNoEntry: false })?.isDirectory();
      const globBase = f.split("/")[0];
      const baseExists = statSync(join(packageDir, globBase), {
        throwIfNoEntry: false,
      })?.isDirectory();
      if (!isFile && !isDir && !baseExists) {
        missing.push(`${entry.name}: ${f}`);
      }
    }
  }
  expect(missing).toEqual([]);
});
