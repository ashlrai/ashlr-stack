import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

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
    scripts: Record<string, string>;
  };
  const missing: string[] = [];
  for (const [name, command] of Object.entries(manifest.scripts)) {
    for (const path of scriptPaths(command)) {
      if (!statSync(`${root}/${path}`, { throwIfNoEntry: false })?.isFile()) {
        missing.push(`${name}: ${path}`);
      }
    }
  }
  expect(missing).toEqual([]);
});
