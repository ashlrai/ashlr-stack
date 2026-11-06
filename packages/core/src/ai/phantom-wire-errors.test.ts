import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StackError } from "../errors.ts";
import { __resetPhantomCache, __setPhantomSpawn, exec, listSecrets } from "../phantom.ts";
import { wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

// Stubbed `phantom` subprocess, like the sibling phantom-wire-*.test.ts files,
// extended for the failure shapes a spawned child can report that a clean exit
// cannot: a signal that killed it, a `close` with no exit code, and spawn
// errors beyond ENOENT. `script` answers per argv, so `--version` can succeed
// while the inventory read fails. `calls` records every argv: whatever the
// failure, wiring may only ever probe (`--version`) or read (`list --json`) —
// never a mutating verb.
type ScriptResult = {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  error?: string;
};
let script: (args: string[]) => ScriptResult = () => ({ code: 0 });
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
    const r = script(args);
    if (r.error) {
      child.emit("error", Object.assign(new Error(`spawn phantom ${r.error}`), { code: r.error }));
      return;
    }
    if (r.stdout) out.emit("data", Buffer.from(r.stdout));
    if (r.stderr) err.emit("data", Buffer.from(r.stderr));
    // An omitted code is a clean exit; explicit null is the shape Node reports
    // for a child that never produced an exit status (signal or unknown end).
    child.emit("close", r.code === undefined ? 0 : r.code, r.signal ?? null);
  });
  return child;
}

const INSTALLED: ScriptResult = { code: 0, stdout: "phantom 0.7.9\n" };

// `--version` answers; the inventory read fails as each test scripted it.
const failList = (result: ScriptResult) => (args: string[]) =>
  args[0] === "list" ? result : INSTALLED;

const RECIPE: Recipe = {
  id: "wire-errors",
  query: "payments",
  createdAt: "2026-04-18T00:00:00.000Z",
  providers: [{ name: "stripe" }, { name: "neon" }],
};

describe("ai/phantom-wire subprocess errors", () => {
  const savedPath = process.env.PATH;
  let binDir: string;
  let projectDir: string;
  let stubPath: string;

  beforeEach(() => {
    binDir = realpathSync(mkdtempSync(join(tmpdir(), "wire-errors-bin-")));
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), "wire-errors-")));
    // The binary only needs to resolve on PATH; spawn is stubbed. The `.sh`
    // target matches the sibling tests (macOS provenance policy).
    writeFileSync(join(binDir, "phantom.sh"), "#!/bin/sh\n");
    chmodSync(join(binDir, "phantom.sh"), 0o755);
    symlinkSync(join(binDir, "phantom.sh"), join(binDir, "phantom"));
    process.env.PATH = binDir;
    stubPath = join(projectDir, ".stack/webhooks/stripe.ts");
    script = () => ({ code: 0 });
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

  it("reaches the caller as a failed read, never as success, when `list` is killed mid-stream", async () => {
    // SIGKILL lands after stdout already carried a valid-looking inventory. A
    // killed child cannot attest a completed read, so those bytes must never
    // legitimize the name they contain.
    script = failList({
      code: null,
      signal: "SIGKILL",
      stdout: '[{"name":"STRIPE_SECRET_KEY"}]',
    });

    // exec() reports the close fields faithfully: a non-zero code, the signal,
    // and a "signal" completion — distinguishable from a clean exit on its own.
    const execResult = await exec(["list", "--json"], {
      cwd: projectDir,
      allowFailure: true,
    });
    expect(execResult).toMatchObject({ code: 1, signal: "SIGKILL", completion: "signal" });
    expect(execResult.code).not.toBe(0);

    // listSecrets' caller gets the typed unavailable-inventory error, not the
    // plausible name the dying child emitted.
    await expect(listSecrets(projectDir)).rejects.toMatchObject({
      code: "PHANTOM_METADATA_UNAVAILABLE",
      message: "Phantom secret inventory is unavailable; stored names are unknown.",
    });

    // And the wire caller sees every provider skipped — never `present` or
    // `missing`, which only a completed read can justify.
    expect(await wirePhantomForRecipe(RECIPE, { cwd: projectDir })).toEqual({
      present: [],
      missing: [],
      webhooks: [stubPath],
      skipped: ["stripe", "neon"],
    });
    expect(existsSync(stubPath)).toBe(true);
    expect(calls).toEqual([
      ["list", "--json"],
      ["--version"],
      ["list", "--json"],
      ["list", "--json"],
    ]);
  });

  it("keeps a `close` with no exit code and no signal unknown, never a completed read", async () => {
    script = failList({ code: null });

    const execResult = await exec(["list", "--json"], {
      cwd: projectDir,
      allowFailure: true,
    });
    // No exit status and no signal: completion stays "unknown" and the code is
    // non-zero — there is nothing a caller could mistake for success.
    expect(execResult).toMatchObject({ code: 1, completion: "unknown" });
    expect(execResult.signal).toBeUndefined();

    await expect(listSecrets(projectDir)).rejects.toMatchObject({
      code: "PHANTOM_METADATA_UNAVAILABLE",
    });
    expect(await wirePhantomForRecipe(RECIPE, { cwd: projectDir })).toEqual({
      present: [],
      missing: [],
      webhooks: [stubPath],
      skipped: ["stripe", "neon"],
    });
  });

  it.each(["EACCES", "EMFILE"])(
    "delivers a refused `list` spawn (%s) to its caller unwrapped, never as an empty vault",
    async (errno) => {
      // ENOENT has a typed mapping (Phantom missing); every other spawn error
      // reaches the caller as itself — unwrapped, not downgraded to a fake
      // inventory or a not-installed hint.
      script = failList({ error: errno });

      await expect(exec(["list", "--json"], { cwd: projectDir })).rejects.toMatchObject({
        code: errno,
      });
      const err = await listSecrets(projectDir).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: errno });
      expect(err).not.toBeInstanceOf(StackError);

      // The wire caller still gets a faithful answer: providers are skipped —
      // the refused spawn never becomes `present`, `missing`, or an empty list.
      expect(await wirePhantomForRecipe(RECIPE, { cwd: projectDir })).toEqual({
        present: [],
        missing: [],
        webhooks: [stubPath],
        skipped: ["stripe", "neon"],
      });
      expect(calls).toEqual([
        ["list", "--json"],
        ["--version"],
        ["list", "--json"],
        ["list", "--json"],
      ]);
    },
  );

  it("treats a binary that vanishes between probe and read as missing — never an empty vault", async () => {
    // `--version` answered, then `list` hits ENOENT: the not-installed mapping
    // surfaces mid-wiring, and `skipped` keeps the providers' secrets unknown —
    // `missing` would falsely claim they were verified absent.
    script = failList({ error: "ENOENT" });

    await expect(listSecrets(projectDir)).rejects.toMatchObject({
      code: "PHANTOM_NOT_INSTALLED",
    });
    expect(await wirePhantomForRecipe(RECIPE, { cwd: projectDir })).toEqual({
      present: [],
      missing: [],
      webhooks: [stubPath],
      skipped: ["stripe", "neon"],
    });
    expect(calls).toEqual([["--version"], ["list", "--json"], ["list", "--json"]]);
  });

  it.each<[string, ScriptResult]>([
    ["a refused spawn (EACCES)", { error: "EACCES" }],
    ["a signal kill (SIGTERM)", { code: null, signal: "SIGTERM" }],
  ])(
    "maps %s on the `--version` probe to not-installed, never to a working phantom",
    async (_label, probeResult) => {
      script = (args) => (args[0] === "--version" ? probeResult : INSTALLED);

      const expected = {
        present: [],
        missing: [],
        webhooks: [stubPath],
        skipped: ["stripe", "neon"],
      };
      expect(await wirePhantomForRecipe(RECIPE, { cwd: projectDir })).toEqual(expected);
      expect(existsSync(stubPath)).toBe(true);
      // The inventory read is never attempted.
      expect(calls).toEqual([["--version"]]);

      // A failed probe is cached for the process: a repeat request reports the
      // same skipped result without re-spawning `--version`.
      expect(await wirePhantomForRecipe(RECIPE, { cwd: projectDir })).toEqual(expected);
      expect(calls).toEqual([["--version"]]);
    },
  );

  it("does not cache a failed inventory read: the next call reports the recovered vault truthfully", async () => {
    let listCalls = 0;
    script = (args) => {
      if (args[0] !== "list") return INSTALLED;
      listCalls += 1;
      return listCalls === 1
        ? { code: 1, stderr: "vault locked" }
        : { code: 0, stdout: '[{"name":"STRIPE_SECRET_KEY"}]' };
    };

    // The first caller gets the failure: both providers skipped, nothing
    // claimed present or missing.
    expect(await wirePhantomForRecipe(RECIPE, { cwd: projectDir })).toEqual({
      present: [],
      missing: [],
      webhooks: [stubPath],
      skipped: ["stripe", "neon"],
    });

    // The failure is not latched: once `list` answers, the next caller gets
    // the real split — stored names present, absent names missing.
    expect(await wirePhantomForRecipe(RECIPE, { cwd: projectDir })).toEqual({
      present: ["stripe:STRIPE_SECRET_KEY"],
      missing: ["neon:NEON_API_KEY", "neon:DATABASE_URL"],
      webhooks: [stubPath],
      skipped: [],
    });
    expect(calls).toEqual([["--version"], ["list", "--json"], ["list", "--json"]]);
  });

  it("rejects to the caller when a stub write fails on top of a failed read", async () => {
    script = failList({ code: 1, stderr: "vault locked" });
    // `stripe.ts` is a directory: writeFile refuses with EISDIR after the
    // inventory read already failed.
    mkdirSync(join(projectDir, ".stack/webhooks/stripe.ts"), { recursive: true });

    // The write failure reaches the caller as the fs error itself — not a
    // WireResult carrying half-finished state a caller could read as success.
    await expect(wirePhantomForRecipe(RECIPE, { cwd: projectDir })).rejects.toMatchObject({
      code: "EISDIR",
    });
    expect(calls).toEqual([["--version"], ["list", "--json"]]);
  });
});
