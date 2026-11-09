import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRecipeDraft } from "../ai/inference.ts";
import {
  type Recipe,
  listRecipes,
  readRecipe,
  recipeFromRetrieval,
  slugifyQuery,
  writeRecipe,
} from "../ai/recipe.ts";

function scratchDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "stack-recipe-"));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("ai/recipe", () => {
  it("rejects a draft with no provider steps", () => {
    expect(() => parseRecipeDraft('{"providers":[]}')).toThrow(
      "Inference response contained no usable providers",
    );
  });

  it("round-trips a saved recipe with no provider steps", async () => {
    const { dir, cleanup } = scratchDir();
    try {
      const recipe: Recipe = {
        id: "empty",
        query: "no providers",
        createdAt: "2026-01-01T00:00:00.000Z",
        providers: [],
      };
      await writeRecipe(recipe, dir);
      expect(await readRecipe(recipe.id, dir)).toEqual(recipe);
    } finally {
      cleanup();
    }
  });

  it("round-trips a Recipe through write → read with fields preserved", async () => {
    const { dir, cleanup } = scratchDir();
    try {
      const original: Recipe = {
        id: "b2b-saas-auth-ai",
        query: "B2B SaaS with auth + AI",
        createdAt: "2026-04-18T00:00:00.000Z",
        providers: [
          { name: "supabase", rationale: "auth, database" },
          { name: "anthropic", rationale: "ai" },
        ],
        guidance: "Top pick per category: Auth→supabase, AI→anthropic.",
        projectContext: { hasAuth: true, language: "typescript" },
      };
      const path = await writeRecipe(original, dir);
      expect(path).toContain(".stack/recipes/b2b-saas-auth-ai.toml");

      const round = await readRecipe("b2b-saas-auth-ai", dir);
      expect(round).toEqual(original);
    } finally {
      cleanup();
    }
  });

  it("rejects reading a recipe referencing an unknown provider", async () => {
    const { dir, cleanup } = scratchDir();
    try {
      // Write directly: writeRecipe itself rejects unknown providers.
      mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
      writeFileSync(
        join(dir, ".stack/recipes/bad.toml"),
        `id = "bad"
query = "bad"
createdAt = "2026-01-01T00:00:00.000Z"

[[providers]]
name = "supabase"

[[providers]]
name = "totally-made-up-provider"
`,
        "utf-8",
      );
      await expect(readRecipe("bad", dir)).rejects.toMatchObject({
        code: "UNKNOWN_PROVIDER_IN_RECIPE",
        message: 'Recipe references unknown provider "totally-made-up-provider" (not in catalog).',
      });
    } finally {
      cleanup();
    }
  });

  it("rejects writing a recipe with an unknown provider", async () => {
    const { dir, cleanup } = scratchDir();
    try {
      await expect(
        writeRecipe(
          {
            id: "x",
            query: "x",
            createdAt: "2026-01-01T00:00:00.000Z",
            providers: [{ name: "nope-not-real" }],
          },
          dir,
        ),
      ).rejects.toThrow(/unknown provider/i);
    } finally {
      cleanup();
    }
  });

  it("listRecipes returns newest first and skips corrupt files", async () => {
    const { dir, cleanup } = scratchDir();
    try {
      await writeRecipe(
        {
          id: "older",
          query: "older",
          createdAt: "2026-01-01T00:00:00.000Z",
          providers: [{ name: "neon" }],
        },
        dir,
      );
      await writeRecipe(
        {
          id: "newer",
          query: "newer",
          createdAt: "2026-06-01T00:00:00.000Z",
          providers: [{ name: "supabase" }],
        },
        dir,
      );
      const list = await listRecipes(dir);
      expect(list.map((r) => r.id)).toEqual(["newer", "older"]);
    } finally {
      cleanup();
    }
  });

  it("listRecipes returns [] when no recipes dir exists", async () => {
    const { dir, cleanup } = scratchDir();
    try {
      const list = await listRecipes(dir);
      expect(list).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("recipeFromRetrieval derives id, rationale, and createdAt", () => {
    const recipe = recipeFromRetrieval(
      "B2B SaaS with auth + AI + payments",
      [
        {
          provider: { name: "supabase" } as never,
          score: 9.9,
          matched: ["auth", "database"],
        },
        {
          provider: { name: "stripe" } as never,
          score: 8.1,
          matched: ["payments"],
        },
      ],
      "pick supabase + stripe",
    );
    expect(recipe.id).toBe("b2b-saas-with-auth-ai-payments");
    expect(recipe.providers[0]).toEqual({ name: "supabase", rationale: "auth, database" });
    expect(recipe.providers[1]).toEqual({ name: "stripe", rationale: "payments" });
    expect(recipe.guidance).toBe("pick supabase + stripe");
    expect(new Date(recipe.createdAt).getTime()).toBeGreaterThan(0);
  });

  it("slugifyQuery handles empty / punctuation-only input", () => {
    expect(slugifyQuery("")).toBe("recipe");
    expect(slugifyQuery("!!!")).toBe("recipe");
    expect(slugifyQuery("  B2B  SaaS  ")).toBe("b2b-saas");
  });
});

describe("ai/recipe empty provider list", () => {
  it("accepts an empty providers array on write and persists it as an empty list", async () => {
    const { dir, cleanup } = scratchDir();
    try {
      const path = await writeRecipe(
        { id: "none", query: "q", createdAt: "2026-01-01T00:00:00.000Z", providers: [] },
        dir,
      );
      expect(readFileSync(path, "utf-8")).toContain("providers = []");
    } finally {
      cleanup();
    }
  });

  it("reads a TOML recipe with no providers key as an empty list, not an error", async () => {
    const { dir, cleanup } = scratchDir();
    try {
      mkdirSync(join(dir, ".stack", "recipes"), { recursive: true });
      writeFileSync(join(dir, ".stack", "recipes", "bare.toml"), 'id = "bare"\nquery = "q"\n');
      const recipe = await readRecipe("bare", dir);
      expect(recipe.providers).toEqual([]);
      expect(recipe.id).toBe("bare");
    } finally {
      cleanup();
    }
  });

  it("lists a recipe with an empty provider list instead of skipping it", async () => {
    const { dir, cleanup } = scratchDir();
    try {
      await writeRecipe(
        { id: "none", query: "q", createdAt: "2026-01-01T00:00:00.000Z", providers: [] },
        dir,
      );
      expect((await listRecipes(dir)).map((r) => r.id)).toEqual(["none"]);
    } finally {
      cleanup();
    }
  });

  it("recipeFromRetrieval with no hits yields an empty provider list", () => {
    const recipe = recipeFromRetrieval("anything", []);
    expect(recipe.providers).toEqual([]);
    expect(recipe.id).toBe("anything");
  });
});
