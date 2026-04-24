import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      // Write a valid recipe first, then corrupt it to contain an unknown provider.
      await writeRecipe(
        {
          id: "bad",
          query: "bad",
          createdAt: "2026-01-01T00:00:00.000Z",
          providers: [{ name: "supabase" }],
        },
        dir,
      );
      const fs = await import("node:fs/promises");
      await fs.writeFile(
        join(dir, ".stack/recipes/bad.toml"),
        `id = "bad"
query = "bad"
createdAt = "2026-01-01T00:00:00.000Z"

[[providers]]
name = "totally-made-up-provider"
`,
        "utf-8",
      );
      await expect(readRecipe("bad", dir)).rejects.toThrow(
        /UNKNOWN_PROVIDER_IN_RECIPE|unknown provider/i,
      );
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
