/**
 * End-to-end integration test for the `stack recommend → stack apply` flow.
 *
 * Exercises the real pipeline via core exports (not by spawning the CLI):
 *
 *   retrieve(query)
 *     → recipeFromRetrieval(...)
 *     → writeRecipe(..., cwd)                  // creates .stack/recipes/<id>.toml
 *     → readRecipe(id, cwd)                    // round-trips through TOML
 *     → wirePhantomForRecipe(recipe, { cwd })  // fills the fake Phantom vault
 *
 * Calling the real provider CLIs (`stack add <provider>`) is out of scope:
 * those make live HTTPS/OAuth calls. This test stops at the phantom-wire
 * boundary, which is exactly what `stack apply --no-wire` would skip.
 *
 * The `setupFakePhantom` harness stubs out the Phantom CLI via a PATH-prefix
 * shell script, so `wirePhantomForRecipe` can shell out for real without
 * hitting the user's actual vault. We assert on its call log.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retrieve } from "../ai/catalog-index.ts";
import { wirePhantomForRecipe } from "../ai/phantom-wire.ts";
import {
  type Recipe,
  listRecipes,
  readRecipe,
  recipeFromRetrieval,
  writeRecipe,
} from "../ai/recipe.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("recommend → apply e2e", () => {
  let harness: Harness;
  // A project-scratch cwd, separate from the phantom harness's own dir, so
  // `.stack/recipes/*.toml` lands in an isolated location we can assert on.
  let projectDir: string;

  beforeEach(() => {
    harness = setupFakePhantom();
    projectDir = mkdtempSync(join(tmpdir(), "stack-e2e-project-"));
  });

  afterEach(() => {
    harness.cleanup();
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("happy path: retrieve → recipeFromRetrieval → writeRecipe → readRecipe → wirePhantomForRecipe", async () => {
    // 1) Simulate `stack recommend "postgres database"` — catalog retrieval.
    const hits = retrieve("postgres database", { k: 3 });
    expect(hits.length).toBeGreaterThan(0);

    // Build a recipe deterministically from small, pure-API-key providers so
    // the apply path never touches a real OAuth flow.
    const recipe: Recipe = {
      id: "postgres-database-e2e",
      query: "postgres database",
      createdAt: new Date().toISOString(),
      providers: [
        { name: "neon", rationale: "database, postgres" },
        { name: "openai", rationale: "ai" },
        { name: "anthropic", rationale: "ai" },
      ],
      guidance: "Neon for DB, OpenAI + Anthropic for AI.",
    };

    // 2) Simulate `--save` — freeze the recipe to TOML under the project cwd.
    const path = await writeRecipe(recipe, projectDir);
    expect(path).toContain(".stack/recipes/postgres-database-e2e.toml");
    expect(existsSync(path)).toBe(true);

    // 3) Simulate `stack apply <id>` reading the TOML back.
    const loaded = await readRecipe("postgres-database-e2e", projectDir);
    expect(loaded.id).toBe(recipe.id);
    expect(loaded.providers.map((p) => p.name)).toEqual(["neon", "openai", "anthropic"]);

    // 4) Wire envelopes via the fake Phantom CLI.
    const result = await wirePhantomForRecipe(loaded, { cwd: projectDir });

    // Every provider's declared catalog secrets must be envelope-added.
    // (neon / openai / anthropic are all api_key providers with known secrets.)
    expect(result.envelopes).toEqual(
      expect.arrayContaining([
        "neon:NEON_API_KEY",
        "openai:OPENAI_API_KEY",
        "anthropic:ANTHROPIC_API_KEY",
      ]),
    );
    expect(result.skipped).toEqual([]);

    // No webhook stubs for these providers — none are in the webhook-capable set.
    expect(result.webhooks).toEqual([]);

    // 5) Inspect the fake Phantom call log — every secret should have been
    // shelled out as `phantom add <KEY> <placeholder>`.
    const adds = harness.callsTo("add");
    const addedKeys = adds.flatMap((c) => c.args);
    expect(addedKeys).toContain("NEON_API_KEY");
    expect(addedKeys).toContain("OPENAI_API_KEY");
    expect(addedKeys).toContain("ANTHROPIC_API_KEY");

    // The placeholder is intentional — `stack add <provider>` would replace it
    // with the real secret. Stopping here is the "noWire: false but no OAuth"
    // boundary: the vault now holds placeholders, not real credentials.
    const vault = JSON.parse(readFileSync(harness.vaultPath, "utf-8")) as Record<string, string>;
    expect(Object.keys(vault)).toEqual(
      expect.arrayContaining(["NEON_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]),
    );
  });

  it("noWire: true performs zero phantom envelope calls and writes no webhook stubs", async () => {
    // Use stripe so we can also prove the webhook stub is skipped — stripe is
    // in WEBHOOK_PROVIDERS, so it would otherwise drop a stub file.
    const recipe: Recipe = {
      id: "payments-nowire",
      query: "payments",
      createdAt: "2026-04-18T00:00:00.000Z",
      providers: [{ name: "stripe", rationale: "payments" }],
    };
    await writeRecipe(recipe, projectDir);
    const loaded = await readRecipe("payments-nowire", projectDir);

    const result = await wirePhantomForRecipe(loaded, {
      cwd: projectDir,
      noWire: true,
    });
    expect(result).toEqual({ envelopes: [], webhooks: [], skipped: [] });

    // Zero phantom calls for recipe secrets.
    expect(harness.callsTo("add")).toEqual([]);

    // And no webhook stub file dropped.
    expect(existsSync(join(projectDir, ".stack/webhooks/stripe.ts"))).toBe(false);
  });

  it("writeRecipe rejects a recipe referencing an unknown provider", async () => {
    const recipe: Recipe = {
      id: "bad",
      query: "unknown",
      createdAt: "2026-04-18T00:00:00.000Z",
      providers: [{ name: "not-a-real-provider" }],
    };
    await expect(writeRecipe(recipe, projectDir)).rejects.toThrow(/unknown provider/i);

    // The thrown error should be a `StackError` with the typed code.
    let caughtCode: string | undefined;
    try {
      await writeRecipe(recipe, projectDir);
    } catch (err) {
      caughtCode = (err as { code?: string }).code;
    }
    expect(caughtCode).toBe("UNKNOWN_PROVIDER_IN_RECIPE");
  });

  it("recipe round-trip preserves rationale fields on providers", async () => {
    const recipe: Recipe = {
      id: "rationale-roundtrip",
      query: "mixed",
      createdAt: "2026-04-18T00:00:00.000Z",
      providers: [
        { name: "openai", rationale: "primary llm" },
        { name: "anthropic", rationale: "fallback + tool use" },
        { name: "stripe", rationale: "billing" },
      ],
      guidance: "ai + payments",
    };
    await writeRecipe(recipe, projectDir);
    const loaded = await readRecipe("rationale-roundtrip", projectDir);

    expect(loaded.providers).toEqual([
      { name: "openai", rationale: "primary llm" },
      { name: "anthropic", rationale: "fallback + tool use" },
      { name: "stripe", rationale: "billing" },
    ]);
    expect(loaded.guidance).toBe("ai + payments");
  });

  it("listRecipes returns freshly-written recipe by id", async () => {
    const base: Omit<Recipe, "id" | "query"> = {
      createdAt: "2026-04-18T12:00:00.000Z",
      providers: [{ name: "openai" }],
    };
    await writeRecipe({ ...base, id: "list-me-a", query: "a" }, projectDir);
    await writeRecipe({ ...base, id: "list-me-b", query: "b" }, projectDir);

    // recipeFromRetrieval → writeRecipe is the shape `stack recommend --save`
    // uses; prove it lands in the same listing surface `stack apply` reads.
    const fromRetrieval = recipeFromRetrieval(
      "openai inference",
      [
        {
          provider: { name: "openai" } as never,
          score: 9,
          matched: ["ai"],
        },
      ],
      "ai only",
    );
    await writeRecipe(fromRetrieval, projectDir);

    const listed = await listRecipes(projectDir);
    const ids = listed.map((r) => r.id);
    expect(ids).toContain("list-me-a");
    expect(ids).toContain("list-me-b");
    expect(ids).toContain(fromRetrieval.id);

    // Spot-check the `recipeFromRetrieval`-derived entry survived the
    // round-trip with its rationale intact.
    const fromList = listed.find((r) => r.id === fromRetrieval.id);
    if (!fromList) throw new Error(`listRecipes missing ${fromRetrieval.id}`);
    expect(fromList.providers).toEqual([{ name: "openai", rationale: "ai" }]);
    expect(fromList.guidance).toBe("ai only");
  });
});
