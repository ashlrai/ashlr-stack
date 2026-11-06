import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packagesDir = fileURLToPath(new URL("../packages/", import.meta.url));

test("each package directory has a package.json with name and version, and all names are unique", () => {
  const errors: string[] = [];
  const names = new Set<string>();

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const manifestPath = join(packagesDir, entry.name, "package.json");
    const stat = statSync(manifestPath, { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;

    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as { name?: unknown; version?: unknown };

    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      errors.push(`${entry.name}: name must be a non-empty string`);
    } else {
      if (names.has(manifest.name)) {
        errors.push(`${entry.name}: duplicate name "${manifest.name}"`);
      } else {
        names.add(manifest.name);
      }
    }

    if (typeof manifest.version !== "string" || manifest.version.length === 0) {
      errors.push(`${entry.name}: version must be a non-empty string`);
    }
  }

  expect(errors).toEqual([]);
});
