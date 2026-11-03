import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = fileURLToPath(new URL("../packages/", import.meta.url));

test("package bin entries reference existing files", () => {
  const missing: string[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = join(packagesDir, entry.name);
    const manifestPath = join(packageDir, "package.json");
    if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const bins = typeof manifest.bin === "string" ? { bin: manifest.bin } : (manifest.bin ?? {});
    for (const [name, path] of Object.entries(bins)) {
      if (!statSync(join(packageDir, path), { throwIfNoEntry: false })?.isFile()) {
        missing.push(`${entry.name} (${name}): ${path}`);
      }
    }
  }
  expect(missing).toEqual([]);
});
