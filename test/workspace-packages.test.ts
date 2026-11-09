import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const packagesDir = join(rootDir, "packages");

/** Maps each package name to every workspace directory that declares it. */
function groupByName(manifests: { dir: string; name: unknown }[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const { dir, name } of manifests) {
    if (typeof name !== "string" || name.length === 0) continue;
    byName.set(name, [...(byName.get(name) ?? []), dir]);
  }
  return byName;
}

/** One message per name used by more than one directory, listing all of them. */
function duplicateNameErrors(manifests: { dir: string; name: unknown }[]): string[] {
  return [...groupByName(manifests)]
    .filter(([, dirs]) => dirs.length > 1)
    .map(([name, dirs]) => `duplicate name "${name}" in: ${dirs.join(", ")}`);
}

const workspaceManifests: { dir: string; name: unknown; version: unknown }[] = [];
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = join(packagesDir, entry.name, "package.json");
  if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
  };
  workspaceManifests.push({ dir: `packages/${entry.name}`, name: manifest.name, version: manifest.version });
}

test("each package directory has a package.json with name and version", () => {
  const errors: string[] = [];
  for (const { dir, name, version } of workspaceManifests) {
    if (typeof name !== "string" || name.length === 0) {
      errors.push(`${dir}: name must be a non-empty string`);
    }
    if (typeof version !== "string" || version.length === 0) {
      errors.push(`${dir}: version must be a non-empty string`);
    }
  }
  expect(errors).toEqual([]);
});

test("workspace package names are unique, including the root package", () => {
  const root = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { name?: unknown };
  expect(duplicateNameErrors([{ dir: ".", name: root.name }, ...workspaceManifests])).toEqual([]);
});

test("duplicate names are reported with every directory that uses them", () => {
  expect(
    duplicateNameErrors([
      { dir: "packages/a", name: "x" },
      { dir: "packages/b", name: "y" },
      { dir: "packages/c", name: "x" },
      { dir: "packages/d", name: undefined },
      { dir: "packages/e", name: undefined },
    ]),
  ).toEqual(['duplicate name "x" in: packages/a, packages/c']);
});
