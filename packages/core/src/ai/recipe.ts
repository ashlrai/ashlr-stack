/**
 * Recipe (de)serialization.
 *
 * A Recipe is the durable, TOML-on-disk artifact of a recommendation pass.
 * Distinct from `RecipeDraft` (the LLM in-memory shape) — once the user
 * accepts a draft, we freeze it to `<cwd>/.stack/recipes/<id>.toml` so
 * `stack apply` can re-run the same set of providers deterministically.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { findProviderRef } from "../catalog.ts";
import { StackError } from "../errors.ts";
import type { RetrievalHit } from "./catalog-index.ts";

export interface Recipe {
  id: string;
  query: string;
  createdAt: string;
  providers: Array<{
    name: string;
    rationale?: string;
  }>;
  guidance?: string;
  projectContext?: Record<string, unknown>;
}

const RECIPES_SUBDIR = ".stack/recipes";

function recipesDir(cwd: string): string {
  return resolve(cwd, RECIPES_SUBDIR);
}

/**
 * Guard recipe ids against path-traversal. `stack apply <id>` forwards the
 * positional directly and `writeRecipe` is also called from MCP (LLM-authored
 * ids), so any `/`, `\`, or `..` would let a caller read/write outside the
 * `.stack/recipes/` sandbox.
 */
function assertSafeRecipeId(id: string): void {
  if (
    !id ||
    /[\\/]/.test(id) ||
    id.includes("..") ||
    id.includes("\0") ||
    /^[A-Za-z]:/.test(id) || // Windows drive-relative path
    id.startsWith(".") ||
    id.length > 200
  ) {
    throw new StackError(
      "INVALID_RECIPE_ID",
      `Recipe id "${id}" contains illegal path characters. Use kebab-case, no separators.`,
    );
  }
}

function recipePath(cwd: string, id: string): string {
  assertSafeRecipeId(id);
  return join(recipesDir(cwd), `${id}.toml`);
}

/**
 * Kebab-case slug from the first ~40 chars of the query. Keeps filenames
 * readable without making them ugly when the query is long.
 */
export function slugifyQuery(query: string): string {
  const slug = query
    .toLowerCase()
    .slice(0, 40)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "recipe";
}

function assertKnownProvider(name: string): void {
  if (!findProviderRef(name)) {
    throw new StackError(
      "UNKNOWN_PROVIDER_IN_RECIPE",
      `Recipe references unknown provider "${name}" (not in catalog).`,
    );
  }
}

export async function writeRecipe(recipe: Recipe, cwd: string = process.cwd()): Promise<string> {
  for (const p of recipe.providers) assertKnownProvider(p.name);
  const dir = recipesDir(cwd);
  await mkdir(dir, { recursive: true });
  const path = recipePath(cwd, recipe.id);
  // smol-toml rejects `undefined` fields — strip before serializing.
  const clean: Record<string, unknown> = {
    id: recipe.id,
    query: recipe.query,
    createdAt: recipe.createdAt,
    providers: recipe.providers.map((p) =>
      p.rationale === undefined ? { name: p.name } : { name: p.name, rationale: p.rationale },
    ),
  };
  if (recipe.guidance !== undefined) clean.guidance = recipe.guidance;
  if (recipe.projectContext !== undefined) clean.projectContext = recipe.projectContext;
  await writeFile(path, stringifyToml(clean), "utf-8");
  return path;
}

export async function readRecipe(id: string, cwd: string = process.cwd()): Promise<Recipe> {
  const path = recipePath(cwd, id);
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (err) {
    throw new StackError("RECIPE_NOT_FOUND", `No recipe "${id}" at ${path}`, { cause: err });
  }
  const raw = parseToml(text) as Record<string, unknown>;
  const recipe = coerceRecipe(raw, id);
  for (const p of recipe.providers) assertKnownProvider(p.name);
  return recipe;
}

export async function listRecipes(cwd: string = process.cwd()): Promise<Recipe[]> {
  const dir = recipesDir(cwd);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: Recipe[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".toml")) continue;
    const id = entry.slice(0, -".toml".length);
    try {
      out.push(await readRecipe(id, cwd));
    } catch {
      // Skip corrupt or unknown-provider recipes rather than erroring the
      // whole picker — the user can still `stack apply <other-id>`.
    }
  }
  // Newest first (createdAt descending) so the interactive picker shows the
  // most recent recommendation at the top.
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

export function recipeFromRetrieval(
  query: string,
  hits: RetrievalHit[],
  guidance?: string,
): Recipe {
  return {
    id: slugifyQuery(query),
    query,
    createdAt: new Date().toISOString(),
    providers: hits.map((h) => ({
      name: h.provider.name,
      rationale: h.matched.length > 0 ? h.matched.join(", ") : undefined,
    })),
    guidance,
  };
}

function coerceRecipe(raw: Record<string, unknown>, fallbackId: string): Recipe {
  const id = typeof raw.id === "string" ? raw.id : fallbackId;
  const query = typeof raw.query === "string" ? raw.query : "";
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();
  const providersRaw = Array.isArray(raw.providers) ? raw.providers : [];
  const providers = providersRaw.map((entry) => {
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : "";
    const rationale = typeof e.rationale === "string" ? e.rationale : undefined;
    return rationale === undefined ? { name } : { name, rationale };
  });
  const recipe: Recipe = { id, query, createdAt, providers };
  if (typeof raw.guidance === "string") recipe.guidance = raw.guidance;
  if (raw.projectContext && typeof raw.projectContext === "object") {
    recipe.projectContext = raw.projectContext as Record<string, unknown>;
  }
  return recipe;
}
