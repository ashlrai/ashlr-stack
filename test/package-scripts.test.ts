import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function scriptValueErrors(packageName: string, scripts: Record<string, unknown>): string[] {
  return Object.entries(scripts)
    .filter(([, value]) => typeof value !== "string" || value.trim().length === 0)
    .map(([name]) => `${packageName}: script ${JSON.stringify(name)} must be a nonempty string`);
}

test("script value errors identify the package and script", () => {
  expect(scriptValueErrors("packages/example", { ok: "echo ok", empty: "", blank: " \n", bad: 42, nil: null })).toEqual([
    'packages/example: script "empty" must be a nonempty string',
    'packages/example: script "blank" must be a nonempty string',
    'packages/example: script "bad" must be a nonempty string',
    'packages/example: script "nil" must be a nonempty string',
  ]);
});

test("package script values are nonempty strings", () => {
  const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`);
  const errors: string[] = [];
  for (const packageDir of [".", ...packages]) {
    const path = join(root, packageDir, "package.json");
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) continue;
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { scripts?: unknown };
    if (manifest.scripts === undefined) continue;
    if (manifest.scripts === null || typeof manifest.scripts !== "object" || Array.isArray(manifest.scripts)) {
      errors.push(`${packageDir}: scripts must be an object`);
      continue;
    }
    errors.push(...scriptValueErrors(packageDir, manifest.scripts as Record<string, unknown>));
  }
  expect(errors).toEqual([]);
});

function scriptPaths(command: string): string[] {
  return Array.from(
    command.matchAll(/(?:^|[\s"'=;(])(?:\.\/)?(scripts\/[^\s"'`;|&<>()]+)/g),
    (match) => match[1],
  );
}

test("finds script paths in npm commands", () => {
  expect(scriptPaths('node ./scripts/first.mjs && node "scripts/nested/second.mjs"')).toEqual([
    "scripts/first.mjs",
    "scripts/nested/second.mjs",
  ]);
  expect(scriptPaths("echo packages/scripts/other.mjs https://example.com/scripts/file.mjs")).toEqual(
    [],
  );
});

test("root npm scripts reference existing script files", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, unknown>;
  };
  const missing: string[] = [];
  for (const [name, command] of Object.entries(manifest.scripts)) {
    if (typeof command !== "string") continue;
    for (const path of scriptPaths(command)) {
      if (!statSync(`${root}/${path}`, { throwIfNoEntry: false })?.isFile()) {
        missing.push(`${name}: ${path}`);
      }
    }
  }
  expect(missing).toEqual([]);
});
