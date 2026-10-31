import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ENTRY_POINTS, findOrphanModules } from "../../../../scripts/no-orphan-modules.ts";

const root = resolve(import.meta.dir, "../../../..");
const scratch: string[] = [];
const core = "packages/core/src/";
const cli = "packages/cli/src/";
const entries = [`${core}index.ts`, `${cli}index.ts`];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "stack-orphans-"));
  scratch.push(dir);
  for (const [path, text] of Object.entries({
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        moduleResolution: "bundler",
        module: "esnext",
        baseUrl: ".",
        paths: { "@ashlr/stack-core": [`${core}index.ts`], "@ashlr/stack-core/*": [`${core}*`] },
      },
    }),
    "scripts/placeholder.ts": "",
    [entries[0]!]: "",
    [entries[1]!]: "",
    ...files,
  })) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return dir;
}

// A whole-repository static scan can exceed Bun's 5s default on a loaded runner.
test("every core and CLI module is reachable from an entry point or production consumer", () => {
  expect(findOrphanModules(root)).toEqual([]);
}, 30_000);

test("the entry point allowlist matches the public core exports and CLI executable", () => {
  const manifest = JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8"));
  expect([...ENTRY_POINTS].sort()).toEqual(
    [
      ...Object.values(manifest.exports).map(
        (path) => `packages/core/${String(path).replace(/^\.\//, "")}`,
      ),
      `${cli}index.ts`,
    ].sort(),
  );
});

test("reports new orphans, test-only imports, self imports, dead chains and cycles", () => {
  const dir = fixture({
    [`${core}orphan.ts`]: "export const unused = true;",
    [`${core}orphan.test.ts`]: 'import "./orphan.ts";',
    [`${cli}__tests__/keep.test.ts`]: 'import "../../../core/src/orphan.ts";',
    [`${core}types.d.ts`]: 'import "./orphan.ts";',
    "scripts/legacy.node-tests.mjs": 'import "../packages/core/src/orphan.ts";',
    [`${core}self.ts`]: 'import "./self.ts";',
    [`${cli}chain.ts`]: 'import "./leaf.ts";',
    [`${cli}leaf.ts`]: "export {};",
    [`${core}a.ts`]: 'import "./b.ts";',
    [`${core}b.ts`]: 'import "./a.ts";',
  });
  expect(findOrphanModules(dir, entries)).toEqual([
    `${cli}chain.ts`,
    `${cli}leaf.ts`,
    `${core}a.ts`,
    `${core}b.ts`,
    `${core}orphan.ts`,
    `${core}self.ts`,
  ]);
});

test("resolves aliases, JS specifiers, reexports, types, dynamic imports and require", () => {
  const dir = fixture({
    [`${cli}index.ts`]:
      'import "@ashlr/stack-core"; import("./lazy.ts"); require("./required.ts");',
    [`${core}index.ts`]: 'export * from "./live.js"; export type { T } from "./types.ts";',
    [`${core}live.ts`]: "export const live = true;",
    [`${core}types.ts`]: "export type T = string;",
    [`${cli}lazy.ts`]:
      'import dep = require("./equals.ts"); type T = import("./import-type.ts").T;',
    [`${cli}required.ts`]: 'import "./side-effect.ts";',
    [`${cli}equals.ts`]: "export {};",
    [`${cli}import-type.ts`]: "export type T = string;",
    [`${cli}side-effect.ts`]: "export {};",
    "packages/mcp/src/consumer.ts": 'import "@ashlr/stack-core/external.ts";',
    [`${core}external.ts`]: "export {};",
  });
  expect(findOrphanModules(dir, entries)).toEqual([]);
});

test("comments and strings are not importers; stale entry points fail closed", () => {
  const dir = fixture({
    [`${cli}index.ts`]: [
      '// import "./unused.ts";',
      "const text = 'import(\"./unused.ts\")';",
      String.raw`const regex = /import(".\/unused.ts")/;`,
      'obj.require("./unused.ts");',
    ].join("\n"),
    [`${cli}unused.ts`]: "export {};",
  });
  expect(findOrphanModules(dir, entries)).toEqual([`${cli}unused.ts`]);
  expect(() => findOrphanModules(dir, [...entries, `${core}missing.ts`])).toThrow(
    "Missing entry point",
  );
});
