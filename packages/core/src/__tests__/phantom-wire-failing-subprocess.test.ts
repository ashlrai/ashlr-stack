import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Script = (args: string[]) => {
  code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
};
let script: Script = () => ({ code: 0 });
const calls: string[][] = [];

function fakeSpawn(_bin: string, args: string[]) {
  calls.push(args);
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
      child.emit("error", Object.assign(new Error(r.error), { code: r.error }));
      return;
    }
    if (r.stdout) out.emit("data", Buffer.from(r.stdout));
    if (r.stderr) err.emit("data", Buffer.from(r.stderr));
    child.emit("close", r.code ?? 0, null);
  });
  return child;
}

import { wirePhantomForRecipe } from "../ai/phantom-wire.ts";
import { __resetPhantomCache, __setPhantomSpawn } from "../phantom.ts";

afterAll(() => {
  __setPhantomSpawn();
  __resetPhantomCache();
});

describe("ai/phantom-wire with a stubbed failing subprocess", () => {
  let dir: string;
  const recipe = {
    id: "stripe-only",
    query: "payments",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: [{ name: "stripe" }, { name: "neon" }],
  };

  const savedPath = process.env.PATH;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "wire-stub-")));
    // The binary is only resolved on PATH, never executed: spawn is stubbed.
    // Link a `.sh` target like _harness.ts: macOS provenance policy rejects
    // an extensionless file written by this process.
    writeFileSync(join(dir, "phantom.sh"), "#!/bin/sh\n");
    chmodSync(join(dir, "phantom.sh"), 0o755);
    symlinkSync(join(dir, "phantom.sh"), join(dir, "phantom"));
    process.env.PATH = dir;
    calls.length = 0;
    __resetPhantomCache();
    __setPhantomSpawn(fakeSpawn as never);
  });
  afterEach(() => {
    process.env.PATH = savedPath;
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips every provider, still writes the stub, and never writes the vault when `phantom list` exits non-zero", async () => {
    script = (args) =>
      args[0] === "--version"
        ? { code: 0, stdout: "phantom 0.7.9\n" }
        : { code: 1, stderr: "vault locked" };

    const result = await wirePhantomForRecipe(recipe, { cwd: dir });

    expect(result).toEqual({
      present: [],
      missing: [],
      webhooks: [join(dir, ".stack/webhooks/stripe.ts")],
      skipped: ["stripe", "neon"],
    });
    expect(existsSync(join(dir, ".stack/webhooks/stripe.ts"))).toBe(true);
    expect(calls).toEqual([["--version"], ["list", "--json"]]);
  });

  it("treats a spawn ENOENT as Phantom missing: skips providers and writes stubs", async () => {
    script = () => ({ error: "ENOENT" });

    const result = await wirePhantomForRecipe(recipe, { cwd: dir });

    expect(result.skipped).toEqual(["stripe", "neon"]);
    expect(result.present).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.webhooks).toEqual([join(dir, ".stack/webhooks/stripe.ts")]);
    expect(calls).toEqual([["--version"]]);
  });

  it("skips providers when `phantom list --json` prints unparseable output", async () => {
    script = (args) => (args[0] === "--version" ? { code: 0 } : { code: 0, stdout: "not json" });

    const result = await wirePhantomForRecipe(recipe, { cwd: dir });

    expect(result.skipped).toEqual(["stripe", "neon"]);
    expect(result.webhooks).toHaveLength(1);
    expect(calls.every((a) => a[0] !== "add")).toBe(true);
  });
});
