import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Harness, setupFakePhantom } from "../__tests__/_harness.ts";
import { addSecret } from "../phantom.ts";
import { wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

// Each check spawns the fake `phantom` shim (bash + python3); several checks
// per test multiply that, so keep the sibling files' raised timeout.
setDefaultTimeout(30_000);

describe("ai/phantom-wire repeated missing-value checks", () => {
  let harness: Harness;
  let dir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    dir = mkdtempSync(join(tmpdir(), "stack wire missing-"));
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  const recipe = (...names: string[]): Recipe => ({
    id: "recheck",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: names.map((name) => ({ name })),
  });

  const vaultText = () => readFileSync(harness.vaultPath, "utf-8");
  // Every logged phantom call must be a read: the install probe or `list`.
  const onlyReadCalls = () =>
    harness.calls().every((c) => c.cmd === "--version" || c.cmd === "list");

  it("re-reports the same secrets missing on every check and never writes placeholders", async () => {
    const before = vaultText();
    const first = await wirePhantomForRecipe(recipe("stripe", "github"), { cwd: dir });
    const firstMissing = [...first.missing];

    // A missing secret is a promise to the user ("store with `phantom add`).
    // Re-checking must not shrink the list, move entries to `present`, or
    // quietly absorb them into `skipped` — each would misreport a write.
    for (let i = 0; i < 3; i++) {
      const again = await wirePhantomForRecipe(recipe("stripe", "github"), { cwd: dir });
      expect(again).toEqual(first);
      expect(again.missing).toEqual(["stripe:STRIPE_SECRET_KEY", "github:GITHUB_TOKEN"]);
      expect(again.present).toEqual([]);
      expect(again.skipped).toEqual([]);
    }
    // Each run builds a fresh result; later checks never mutate earlier ones.
    expect(first.missing).toEqual(firstMissing);

    // Placeholder values would require a vault write. The whole call log is
    // one `--version` probe plus one `list --json` per check — never `add`,
    // `init`, `remove` or `sync` — and the vault file is byte-identical.
    expect(onlyReadCalls()).toBe(true);
    expect(harness.callsTo("list")).toHaveLength(4);
    expect(harness.callsTo("add")).toEqual([]);
    expect(vaultText()).toBe(before);
    expect(JSON.parse(vaultText())).toEqual({});
  });

  it("keeps a partial vault's present/missing split identical across repeated checks", async () => {
    writeFileSync(harness.vaultPath, JSON.stringify({ SUPABASE_ANON_KEY: "x" }));
    const missing = [
      "supabase:SUPABASE_URL",
      "supabase:SUPABASE_SERVICE_ROLE_KEY",
      "openai:OPENAI_API_KEY",
    ];

    for (let i = 0; i < 3; i++) {
      const result = await wirePhantomForRecipe(recipe("supabase", "openai"), { cwd: dir });
      expect(result.present).toEqual(["supabase:SUPABASE_ANON_KEY"]);
      expect(result.missing).toEqual(missing);
      expect(result.skipped).toEqual([]);
    }

    expect(onlyReadCalls()).toBe(true);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(vaultText())).toEqual({ SUPABASE_ANON_KEY: "x" });
  });

  it("moves a secret to present only after a real `phantom add`, never from re-checking", async () => {
    for (let i = 0; i < 2; i++) {
      const result = await wirePhantomForRecipe(recipe("stripe"), { cwd: dir });
      expect(result.missing).toEqual(["stripe:STRIPE_SECRET_KEY"]);
      expect(result.present).toEqual([]);
    }
    expect(harness.callsTo("add")).toEqual([]);

    // A real write through Phantom is the only thing that may shrink
    // `missing`; the check itself reports it faithfully afterwards.
    await addSecret("STRIPE_SECRET_KEY", "user-supplied-real-value", dir);
    const after = await wirePhantomForRecipe(recipe("stripe"), { cwd: dir });
    expect(after.present).toEqual(["stripe:STRIPE_SECRET_KEY"]);
    expect(after.missing).toEqual([]);

    // Exactly one `add` in the log — the explicit write above, in create-only
    // `--stdin` form. The checks contributed none.
    expect(harness.callsTo("add")).toEqual([
      { cmd: "add", args: ["STRIPE_SECRET_KEY", "--stdin"] },
    ]);
  });

  it("leaves no placeholder artifacts on disk beyond the documented webhook stubs", async () => {
    // `openai` has missing secrets and no webhook stub: a repeated check must
    // not drop a placeholder file for it anywhere in the project tree.
    for (let i = 0; i < 2; i++) {
      await wirePhantomForRecipe(recipe("stripe", "openai", "github"), { cwd: dir });
    }

    expect(readdirSync(dir)).toEqual([".stack"]);
    expect(readdirSync(join(dir, ".stack"))).toEqual(["webhooks"]);
    expect(readdirSync(join(dir, ".stack", "webhooks")).sort()).toEqual(["github.ts", "stripe.ts"]);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(harness.callsTo("add")).toEqual([]);
    expect(JSON.parse(vaultText())).toEqual({});
  });
});
