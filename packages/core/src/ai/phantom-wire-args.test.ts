import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Harness, setupFakePhantom } from "../__tests__/_harness.ts";
import { exec } from "../phantom.ts";
import { wirePhantomForRecipe } from "./phantom-wire.ts";
import type { Recipe } from "./recipe.ts";

// Each test spawns the fake `phantom` shim (bash + python3).
setDefaultTimeout(30_000);

describe("ai/phantom-wire argv handling with spaces", () => {
  let harness: Harness;
  let spaced: string;

  beforeEach(() => {
    harness = setupFakePhantom({ STRIPE_SECRET_KEY: "x" });
    spaced = join(mkdtempSync(join(tmpdir(), "stack wire args-")), "my project dir");
    mkdirSync(spaced, { recursive: true });
  });
  afterEach(() => {
    harness.cleanup();
    rmSync(join(spaced, ".."), { recursive: true, force: true });
  });

  const recipe = (name: string): Recipe => ({
    id: "spaces",
    query: "q",
    createdAt: "2026-04-18T00:00:00.000Z",
    providers: [{ name }],
  });

  it("runs phantom with fixed argv and a project path containing spaces intact", async () => {
    const result = await wirePhantomForRecipe(recipe("stripe"), { cwd: spaced });

    // The spaced path is the child's cwd, never split into argv.
    const list = harness.callsTo("list");
    expect(list).toHaveLength(1);
    expect(list[0]?.args).toEqual(["--json"]);
    expect(result.present).toContain("stripe:STRIPE_SECRET_KEY");
    expect(result.webhooks).toEqual([join(spaced, ".stack", "webhooks", "stripe.ts")]);
    expect(readFileSync(result.webhooks[0] as string, "utf-8")).toContain("stripe");
  });

  it("never forwards a provider name containing spaces to phantom", async () => {
    const result = await wirePhantomForRecipe(recipe("my provider name"), { cwd: spaced });

    expect(result.skipped).toEqual(["my provider name"]);
    for (const call of harness.calls()) {
      expect(call.args.join("\0")).not.toContain("my provider name");
    }
  });

  it("delivers an argument containing spaces to the subprocess as one argument", async () => {
    const value = "SECRET WITH  SPACES";
    await exec(["remove", value], { cwd: spaced, allowFailure: true });

    const calls = harness.callsTo("remove");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([value]);
  });
});
