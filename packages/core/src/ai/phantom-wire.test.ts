import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetPhantomCache, __setPhantomSpawn } from "../phantom.ts";
import { webhookStubFor, wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

// Stubbed `phantom` subprocess, like phantom-wire-order.test.ts, but recording
// every argv: an empty wiring request may run the read-only probes
// (`--version`, `list --json`) but must never reach a mutating subcommand
// (`add`, `remove`, `init`) or write a file.
let installed = true;
let vault: string[] | "unreadable" = [];
let calls: string[][] = [];

function fakeSpawn(_bin: string, args: string[]) {
  calls.push([...args]);
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const out = new EventEmitter();
  const err = new EventEmitter();
  Object.assign(child, {
    stdout: Object.assign(out, { destroy() {} }),
    stderr: Object.assign(err, { destroy() {} }),
    stdin: { on() {}, write() {}, end() {}, destroy() {} },
    pid: undefined,
    kill() {},
    unref() {},
  });
  queueMicrotask(() => {
    if (!installed) {
      child.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
      return;
    }
    if (args[0] === "list") {
      if (vault === "unreadable") {
        child.emit("close", 1, null);
        return;
      }
      out.emit("data", Buffer.from(JSON.stringify(vault.map((name) => ({ name })))));
    }
    child.emit("close", 0, null);
  });
  return child;
}

function recipeOf(...names: string[]): Recipe {
  return {
    id: "empty-wire",
    query: "empty",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  };
}

const EMPTY_RESULT = { present: [], missing: [], webhooks: [], skipped: [] };

it("preserves a placeholder-free verification hint in the rendered stub", () => {
  const hint = "Verify per the provider's documented signature scheme.";
  const hintLine = webhookStubFor("example")
    .split("\n")
    .find((line) => line.includes(hint));

  expect(hintLine).toBe(`//   // ${hint}`);
});

describe("ai/phantom-wire empty wiring request", () => {
  const savedPath = process.env.PATH;
  let binDir: string;
  let projectDir: string;

  beforeEach(() => {
    binDir = realpathSync(mkdtempSync(join(tmpdir(), "wire-empty-bin-")));
    // The project dir starts empty and must stay empty: no `.stack/` tree,
    // no webhook stubs, nothing.
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), "wire-empty-")));
    // Binary only needs to resolve on PATH; spawn is stubbed. `.sh` target
    // matches the sibling tests (macOS provenance policy).
    writeFileSync(join(binDir, "phantom.sh"), "#!/bin/sh\n");
    chmodSync(join(binDir, "phantom.sh"), 0o755);
    symlinkSync(join(binDir, "phantom.sh"), join(binDir, "phantom"));
    process.env.PATH = binDir;
    installed = true;
    vault = [];
    calls = [];
    __resetPhantomCache();
    __setPhantomSpawn(fakeSpawn as never);
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    rmSync(binDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
  });

  afterAll(() => {
    __setPhantomSpawn();
    __resetPhantomCache();
  });

  it("returns the documented empty result and performs no write for a providerless recipe", async () => {
    const r = await wirePhantomForRecipe(recipeOf(), { cwd: projectDir });

    expect(r).toEqual(EMPTY_RESULT);
    // Nothing requested, so no process ran at all: no install probe, no
    // `list`, and certainly no `add`, `remove`, or `init`.
    expect(calls).toEqual([]);
    expect(readdirSync(projectDir)).toEqual([]);
  });

  it("performs no write for a providerless recipe even when the vault is unreadable", async () => {
    vault = "unreadable";
    const r = await wirePhantomForRecipe(recipeOf(), { cwd: projectDir });

    // The unreadable vault leaves nothing to skip: every list stays empty.
    expect(r).toEqual(EMPTY_RESULT);
    expect(calls).toEqual([]);
    expect(readdirSync(projectDir)).toEqual([]);
  });

  it("performs no write for a providerless recipe when phantom is not installed", async () => {
    installed = false;
    const r = await wirePhantomForRecipe(recipeOf(), { cwd: projectDir });

    // With no providers there is nothing to skip and no stub to write, so a
    // missing phantom still yields the documented empty result.
    expect(r).toEqual(EMPTY_RESULT);
    expect(calls).toEqual([]);
    expect(readdirSync(projectDir)).toEqual([]);
  });

  it("spawns nothing and writes nothing when the request opts out with noWire", async () => {
    // `--no-wire` returns before the install probe: providers or not, an
    // opted-out request must not touch phantom or the filesystem at all.
    for (const recipe of [recipeOf(), recipeOf("stripe", "github")]) {
      calls = [];
      const r = await wirePhantomForRecipe(recipe, { cwd: projectDir, noWire: true });

      expect(r).toEqual(EMPTY_RESULT);
      expect(calls).toEqual([]);
      expect(readdirSync(projectDir)).toEqual([]);
    }
  });
});
