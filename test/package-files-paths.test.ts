import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = fileURLToPath(new URL("../packages/", import.meta.url));

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
      const isGlob = /\*|\\?/.test(f);
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
