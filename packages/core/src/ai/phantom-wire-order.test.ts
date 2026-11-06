import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { __resetPhantomCache, __setPhantomSpawn } from "../phantom.ts";
import { wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

// Stubbed `phantom` subprocess: `--version` succeeds (unless `installed` is
// false) and `list --json` returns the names in `vault`.
let installed = true;
let vault: string[] | "unreadable" = [];

function fakeSpawn(_bin: string, args: string[]) {
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
    id: "order",
    query: "order",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  };
}

describe("ai/phantom-wire result ordering with multiple providers", () => {
  const savedPath = process.env.PATH;
  let dir: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "wire-order-")));
    // Binary only needs to resolve on PATH; spawn is stubbed. `.sh` target
    // matches the sibling failing-subprocess test (macOS provenance policy).
    writeFileSync(join(dir, "phantom.sh"), "#!/bin/sh\n");
    chmodSync(join(dir, "phantom.sh"), 0o755);
    symlinkSync(join(dir, "phantom.sh"), join(dir, "phantom"));
    process.env.PATH = dir;
    installed = true;
    vault = [];
    __resetPhantomCache();
    __setPhantomSpawn(fakeSpawn as never);
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    rmSync(dir, { recursive: true, force: true });
  });

  afterAll(() => {
    __setPhantomSpawn();
    __resetPhantomCache();
  });

  it("reports present and missing secrets in recipe order, then catalog secret order", async () => {
    vault = ["OPENAI_API_KEY", "SUPABASE_ANON_KEY"];
    const r = await wirePhantomForRecipe(recipeOf("stripe", "supabase", "openai", "github"), {
      cwd: dir,
    });
    expect(r.present).toEqual(["supabase:SUPABASE_ANON_KEY", "openai:OPENAI_API_KEY"]);
    expect(r.missing).toEqual([
      "stripe:STRIPE_SECRET_KEY",
      "supabase:SUPABASE_URL",
      "supabase:SUPABASE_SERVICE_ROLE_KEY",
      "github:GITHUB_TOKEN",
    ]);
    expect(r.skipped).toEqual([]);
  });

  it("follows input order, not alphabetical or catalog order", async () => {
    const forward = await wirePhantomForRecipe(recipeOf("github", "stripe", "clerk"), { cwd: dir });
    const reversed = await wirePhantomForRecipe(recipeOf("clerk", "stripe", "github"), {
      cwd: dir,
    });
    const names = (r: { webhooks: string[] }) =>
      r.webhooks.map((p) => p.split("/").pop()?.replace(/\.ts$/, ""));
    expect(names(forward)).toEqual(["github", "stripe", "clerk"]);
    expect(names(reversed)).toEqual(["clerk", "stripe", "github"]);
    expect(forward.missing.map((m) => m.split(":")[0])).toEqual(["github", "stripe", "clerk"]);
    expect(reversed.missing.map((m) => m.split(":")[0])).toEqual(["clerk", "stripe", "github"]);
  });

  it("keeps unknown providers in place in skipped and still orders the rest", async () => {
    const r = await wirePhantomForRecipe(
      recipeOf("zzz-unknown", "stripe", "aaa-unknown", "github"),
      {
        cwd: dir,
      },
    );
    expect(r.skipped).toEqual(["zzz-unknown", "aaa-unknown"]);
    expect(r.missing).toEqual(["stripe:STRIPE_SECRET_KEY", "github:GITHUB_TOKEN"]);
    expect(r.webhooks.map((p) => p.split("/").pop())).toEqual(["stripe.ts", "github.ts"]);
  });

  it("marks every provider skipped, in input order, when the vault is unreadable", async () => {
    vault = "unreadable";
    const r = await wirePhantomForRecipe(recipeOf("github", "openai", "stripe"), { cwd: dir });
    expect(r.skipped).toEqual(["github", "openai", "stripe"]);
    expect(r.present).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.webhooks.map((p) => p.split("/").pop())).toEqual(["github.ts", "stripe.ts"]);
  });

  it("lists skipped providers and webhook stubs in input order when phantom is missing", async () => {
    installed = false;
    const r = await wirePhantomForRecipe(recipeOf("stripe", "openai", "clerk", "github"), {
      cwd: dir,
    });
    expect(r.skipped).toEqual(["stripe", "openai", "clerk", "github"]);
    expect(r.webhooks.map((p) => p.split("/").pop())).toEqual([
      "stripe.ts",
      "clerk.ts",
      "github.ts",
    ]);
    expect(r.present).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("repeats duplicate providers once per input entry, in order", async () => {
    vault = ["STRIPE_SECRET_KEY"];
    const r = await wirePhantomForRecipe(recipeOf("stripe", "github", "stripe"), { cwd: dir });
    expect(r.present).toEqual(["stripe:STRIPE_SECRET_KEY", "stripe:STRIPE_SECRET_KEY"]);
    expect(r.missing).toEqual(["github:GITHUB_TOKEN"]);
    expect(r.webhooks.map((p) => p.split("/").pop())).toEqual([
      "stripe.ts",
      "github.ts",
      "stripe.ts",
    ]);
  });

  it("is deterministic across repeated runs of the same recipe", async () => {
    vault = ["SENTRY_DSN", "RESEND_API_KEY"];
    const recipe = recipeOf("sentry", "nope", "resend", "stripe", "supabase");
    const first = await wirePhantomForRecipe(recipe, { cwd: dir });
    for (let i = 0; i < 5; i++) {
      expect(await wirePhantomForRecipe(recipe, { cwd: dir })).toEqual(first);
    }
  });

  it("returns empty ordered lists for an empty recipe and for noWire", async () => {
    const empty = { present: [], missing: [], webhooks: [], skipped: [] };
    expect(await wirePhantomForRecipe(recipeOf(), { cwd: dir })).toEqual(empty);
    expect(
      await wirePhantomForRecipe(recipeOf("stripe", "github"), { cwd: dir, noWire: true }),
    ).toEqual(empty);
  });
});
