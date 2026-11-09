import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** One message per package whose name is not a non-empty string unchanged by trimming. */
function nameShapeErrors(manifests: { dir: string; name: unknown }[]): string[] {
  const errors: string[] = [];
  for (const { dir, name } of manifests) {
    if (typeof name !== "string" || name.length === 0) {
      errors.push(`${dir}: name must be a non-empty string`);
    } else if (name !== name.trim()) {
      errors.push(`${dir}: name ${JSON.stringify(name)} has surrounding whitespace`);
    }
  }
  return errors;
}

function discoverWorkspaceManifests(packagesPath: string): { dir: string; name: unknown; version: unknown }[] {
  const manifests: { dir: string; name: unknown; version: unknown }[] = [];
  for (const entry of readdirSync(packagesPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesPath, entry.name, "package.json");
    if (!statSync(manifestPath, { throwIfNoEntry: false })?.isFile()) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    manifests.push({ dir: `packages/${entry.name}`, name: manifest.name, version: manifest.version });
  }
  return manifests;
}

const workspaceManifests = discoverWorkspaceManifests(packagesDir);

test("discovers a workspace package whose path contains spaces once", () => {
  const fixture = mkdtempSync(join(tmpdir(), "workspace packages "));
  try {
    const fixturePackages = join(fixture, "packages");
    const packageDir = join(fixturePackages, "package with spaces");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "space-package", version: "1.0.0" }));

    expect(discoverWorkspaceManifests(fixturePackages)).toEqual([
      { dir: "packages/package with spaces", name: "space-package", version: "1.0.0" },
    ]);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("each package directory has a package.json with name and version", () => {
  const errors: string[] = nameShapeErrors(workspaceManifests);
  for (const { dir, version } of workspaceManifests) {
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

test("names with surrounding whitespace or no content are reported", () => {
  expect(
    nameShapeErrors([
      { dir: "packages/ok", name: "@ashlr/ok" },
      { dir: "packages/lead", name: " lead" },
      { dir: "packages/trail", name: "trail\n" },
      { dir: "packages/blank", name: "" },
      { dir: "packages/ws", name: "  " },
      { dir: "packages/num", name: 5 },
    ]),
  ).toEqual([
    'packages/lead: name " lead" has surrounding whitespace',
    'packages/trail: name "trail\\n" has surrounding whitespace',
    "packages/blank: name must be a non-empty string",
    'packages/ws: name "  " has surrounding whitespace',
    "packages/num: name must be a non-empty string",
  ]);
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
