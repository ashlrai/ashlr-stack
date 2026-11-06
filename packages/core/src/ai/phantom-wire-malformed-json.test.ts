import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StackError } from "../errors.ts";
import { __resetPhantomCache, __setPhantomSpawn, listSecrets } from "../phantom.ts";
import { wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

// Stubbed `phantom` subprocess, like the sibling phantom-wire-*.test.ts files:
// `--version` succeeds and `list --json` emits whatever bytes `listOutput`
// holds. Because spawn itself is replaced, no child process — and no socket —
// ever exists: the malformed-inventory path provably makes no network access.
// `calls` records every argv so the tests can pin the read-only verbs
// (`--version`, `list --json`) and exclude every mutating one.
let installed = true;
let listOutput: string[] | "unreadable" = ["[]"];
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
      if (listOutput === "unreadable") {
        child.emit("close", 1, null);
        return;
      }
      // Emit each element as its own `data` event: exec() reassembles stdout
      // from chunks, and only the joined bytes are parsed.
      for (const chunk of listOutput) out.emit("data", Buffer.from(chunk));
    }
    child.emit("close", 0, null);
  });
  return child;
}

function recipeOf(...names: string[]): Recipe {
  return {
    id: "malformed-json",
    query: "malformed",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  };
}

async function listSecretsError(cwd: string): Promise<unknown> {
  try {
    await listSecrets(cwd);
  } catch (err) {
    return err;
  }
  throw new Error("listSecrets resolved; expected a rejection");
}

describe("ai/phantom-wire malformed vault inventory JSON", () => {
  const savedPath = process.env.PATH;
  let binDir: string;
  let projectDir: string;

  beforeEach(() => {
    binDir = realpathSync(mkdtempSync(join(tmpdir(), "wire-badjson-bin-")));
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), "wire-badjson-")));
    // Binary only needs to resolve on PATH; spawn is stubbed. `.sh` target
    // matches the sibling tests (macOS provenance policy).
    writeFileSync(join(binDir, "phantom.sh"), "#!/bin/sh\n");
    chmodSync(join(binDir, "phantom.sh"), 0o755);
    symlinkSync(join(binDir, "phantom.sh"), join(binDir, "phantom"));
    process.env.PATH = binDir;
    installed = true;
    listOutput = ["[]"];
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

  it.each([
    // A zero-byte answer is a successful exit with nothing to parse.
    ["empty stdout", [""]],
    ["whitespace only", ["  \n\t "]],
    // Truncated mid-entry: the bytes still carry a plausible secret name,
    // which must never be reported as present.
    ["truncated mid-entry", ['[{"name":"STRIPE_SECRET_KEY"']],
    // A valid array followed by junk: JSON.parse rejects trailing content.
    ["trailing garbage", ['[{"name":"STRIPE_SECRET_KEY"}]\n{"name":"EXTRA"}']],
    // The decorated table an older Phantom prints when it ignores `--json` —
    // the exact "upgrade Phantom Secrets" scenario the error names.
    ["human table output", ["-> 1 secret(s) in vault (encrypted-file):\n   - STRIPE_SECRET_KEY\n"]],
    // Leading BOM is not JSON whitespace.
    ["BOM-prefixed array", ['\uFEFF[{"name":"STRIPE_SECRET_KEY"}]']],
    // Interleaved garbage across chunk boundaries is still one unparseable body.
    ["noise split across chunks", ['[{"name":"STRIPE', '"}} nonsense [']],
  ])(
    "reports %s as the documented unrecognized-output error, never an uncaught SyntaxError",
    async (_label, chunks) => {
      listOutput = chunks;

      const err = await listSecretsError(projectDir);
      // The handler's expected error: a typed StackError with the documented
      // code — not the raw JSON.parse SyntaxError escaping uncaught.
      expect(err).toBeInstanceOf(StackError);
      expect(err).not.toBeInstanceOf(SyntaxError);
      expect(err).toMatchObject({
        code: "PHANTOM_OUTPUT_UNRECOGNIZED",
        message:
          "phantom list --json did not return JSON; upgrade Phantom Secrets to 0.7.9 or newer.",
      });

      // The wiring request still resolves: the unreadable inventory degrades
      // to `skipped` with no present/missing claims — including the plausible
      // name the truncated bytes contained — while the webhook stub is written.
      const result = await wirePhantomForRecipe(recipeOf("stripe"), { cwd: projectDir });
      expect(result.present).toEqual([]);
      expect(result.missing).toEqual([]);
      expect(result.skipped).toEqual(["stripe"]);
      const stubPath = join(projectDir, ".stack/webhooks/stripe.ts");
      expect(result.webhooks).toEqual([stubPath]);
      expect(existsSync(stubPath)).toBe(true);

      // Metadata only: the install probe plus two inventory reads. The spawn
      // stub means no process or socket exists; no mutating verb ever runs.
      expect(calls).toEqual([["--version"], ["list", "--json"], ["list", "--json"]]);
    },
  );

  it.each([
    ["a string entry", '["STRIPE_SECRET_KEY"]'],
    ["a null entry", "[null]"],
    ["a nested array entry", '[["STRIPE_SECRET_KEY"]]'],
    ["a numeric name", '[{"name":42}]'],
    ["an empty name", '[{"name":""}]'],
    ["an entry with no name", '[{"detected_service":null}]'],
    // One malformed entry poisons the whole inventory: names are never
    // partially trusted.
    ["one bad entry among valid ones", '[{"name":"OPENAI_API_KEY"},{"name":42}]'],
  ])(
    "rejects %s in the inventory array and keeps the provider's secrets unknown",
    async (_label, output) => {
      listOutput = [output];

      await expect(listSecrets(projectDir)).rejects.toMatchObject({
        code: "PHANTOM_OUTPUT_UNRECOGNIZED",
        message: "phantom list --json contains unrecognized secret-name metadata.",
      });

      const result = await wirePhantomForRecipe(recipeOf("stripe"), { cwd: projectDir });
      expect(result).toEqual({
        present: [],
        missing: [],
        skipped: ["stripe"],
        webhooks: [join(projectDir, ".stack/webhooks/stripe.ts")],
      });
      expect(calls).toEqual([["--version"], ["list", "--json"], ["list", "--json"]]);
    },
  );

  it("parses inventory JSON only after all stdout chunks arrive", async () => {
    // Each partial chunk is malformed JSON on its own; only the reassembled
    // body parses. Guards against regressing to per-chunk parsing.
    listOutput = ['[{"name":"STRI', "PE_SEC", 'RET_KEY"}]'];

    expect(await listSecrets(projectDir)).toEqual(["STRIPE_SECRET_KEY"]);
    const result = await wirePhantomForRecipe(recipeOf("stripe"), { cwd: projectDir });
    expect(result.present).toEqual(["stripe:STRIPE_SECRET_KEY"]);
    expect(result.skipped).toEqual([]);
  });

  it("keeps malformed inventory bytes off every verb except the read-only probes", async () => {
    listOutput = ['[{"name":"STRIPE_SECRET_KEY"'];
    await wirePhantomForRecipe(recipeOf("stripe"), { cwd: projectDir });

    // Whatever the vault answer looks like, wiring may probe the install and
    // read names — never `add`, `remove`, `init`, `reveal`, `status`, `sync`.
    for (const argv of calls) expect(["--version", "list"]).toContain(argv[0]);
    expect(calls).toEqual([["--version"], ["list", "--json"]]);
  });

  it("makes no network access: the module has no network call sites", () => {
    // phantom-wire.ts shells out to a local `phantom` binary and writes files;
    // the only request handler it mentions is the commented-out stub example.
    // Pin that wiring stays metadata-only and cannot reach the network even if
    // a future edit is tempted to fall back to a remote probe.
    const source = readFileSync(
      fileURLToPath(new URL("./phantom-wire.ts", import.meta.url)),
      "utf-8",
    );
    expect(source).not.toMatch(
      /\bfetch\(|node:(http|https|net|dgram|tls)|new WebSocket|XMLHttpRequest|undici/,
    );
  });
});
