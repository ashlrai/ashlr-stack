import { defineCommand } from "citty";
import {
  PROVIDER_CATEGORIES,
  getInferenceBackend,
  NoInferenceBackendError,
  recipeFromRetrieval,
  retrieve,
  retrieveByCategory,
  writeRecipe,
  type Recipe,
  type RetrievalHit,
} from "@ashlr/stack-core";
import { colors, intro, outro } from "../ui.ts";

/**
 * `stack recommend` — free-text → curated providers.
 *
 * Three execution paths:
 *   1. Default  — pure BM25 retrieval. Instant, zero-IO, no LLM. The shape
 *      Claude consumes via the `stack_recommend` MCP tool.
 *   2. `--save` — also freezes the result to `.stack/recipes/<id>.toml` so
 *      the user can follow up with `stack apply <id>`.
 *   3. `--synth` — pipes the retrieval candidates into the local SLM backend
 *      (LM Studio / Ollama via OpenAI-compatible HTTP) and swaps the
 *      retrieval-only rationales for model-authored ones. No-ops gracefully
 *      when neither endpoint is reachable.
 *
 * Output modes:
 *   - default: human-readable list, grouped by category
 *   - --json: machine-readable blob (used by the MCP server + site /api)
 */

interface RecommendOutputHit {
  name: string;
  displayName: string;
  category: string;
  authKind: string;
  secrets: string[];
  blurb: string;
  score: number;
  matched: string[];
  rationale?: string;
}

interface RecommendOutput {
  query: string;
  hits: RecommendOutputHit[];
  byCategory: Record<string, Array<{ name: string; score: number }>>;
  guidance: string;
  recipe?: { id: string; path: string };
  inference?: { mode: "synth" | "mcp-delegated"; backend: string; note?: string };
}

function toOutputHit(
  hit: RetrievalHit,
  rationale?: string,
): RecommendOutputHit {
  return {
    name: hit.provider.name,
    displayName: hit.provider.displayName,
    category: hit.provider.category,
    authKind: hit.provider.authKind,
    secrets: hit.provider.secrets,
    blurb: hit.provider.blurb,
    score: Number(hit.score.toFixed(3)),
    matched: hit.matched,
    rationale,
  };
}

function buildGuidance(hits: RetrievalHit[], categories: string[]): string {
  if (hits.length === 0) {
    return "No strong matches. Try describing the concrete capability you need (e.g. 'postgres database', 'stripe subscriptions', 'deploy frontend').";
  }
  const covered = new Set(hits.map((h) => h.provider.category));
  const missing = categories.filter(
    (c) => !covered.has(c as (typeof PROVIDER_CATEGORIES)[number]),
  );
  const topByCat = Object.entries(
    hits.reduce<Record<string, RetrievalHit>>((acc, h) => {
      if (!acc[h.provider.category] || acc[h.provider.category].score < h.score) {
        acc[h.provider.category] = h;
      }
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1].score - a[1].score)
    .map(([cat, h]) => `${cat}→${h.provider.name}`);
  const parts = [`Top pick per category: ${topByCat.join(", ")}.`];
  if (missing.length > 0) {
    parts.push(
      `No matches surfaced for: ${missing.join(", ")}. Add terms for those categories if the user needs them.`,
    );
  }
  parts.push(
    `Apply a chosen set with: stack add ${hits.slice(0, 3).map((h) => h.provider.name).join(" ")} (or supply your own list).`,
  );
  return parts.join(" ");
}

function buildCatalogContext(hits: RetrievalHit[]): string {
  return hits
    .map(
      (h) =>
        `- ${h.provider.name} (${h.provider.category}): ${h.provider.blurb} [secrets: ${h.provider.secrets.join(", ")}]`,
    )
    .join("\n");
}

async function trySynth(
  query: string,
  hits: RetrievalHit[],
): Promise<{ rationales: Map<string, string>; note?: string; backend: string; mode: "synth" | "mcp-delegated" } | null> {
  try {
    const backend = await getInferenceBackend({ preferLocal: true });
    const result = await backend.infer({
      query,
      catalogContext: buildCatalogContext(hits),
    });
    const rationales = new Map<string, string>();
    for (const p of result.recipe?.providers ?? []) {
      if (p.rationale) rationales.set(p.name, p.rationale);
    }
    return {
      rationales,
      note: result.recipe?.notes,
      backend: backend.name,
      mode: result.mode,
    };
  } catch (err) {
    if (err instanceof NoInferenceBackendError) return null;
    throw err;
  }
}

export const recommendCommand = defineCommand({
  meta: {
    name: "recommend",
    description: "Pick the right providers for what you're building (AI-assisted).",
  },
  args: {
    query: {
      type: "positional",
      description: "Free-text description of the project (in quotes).",
      required: false,
    },
    k: {
      type: "string",
      description: "Max results to return (default 6).",
      required: false,
    },
    category: {
      type: "string",
      description: "Restrict to a single category (e.g. Database, Auth).",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Machine-readable JSON output.",
      required: false,
    },
    save: {
      type: "boolean",
      description:
        "Persist the result as .stack/recipes/<id>.toml so you can run `stack apply <id>`.",
      required: false,
    },
    synth: {
      type: "boolean",
      description:
        "Call the local SLM (LM Studio / Ollama) to synthesize rationales. Silently falls back to retrieval-only when no endpoint is reachable.",
      required: false,
    },
  },
  async run({ args }) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      if (args.json) {
        console.log(
          JSON.stringify(
            {
              query: "",
              hits: [],
              byCategory: {},
              guidance: "Provide a query: stack recommend \"what you're building\".",
            } satisfies RecommendOutput,
            null,
            2,
          ),
        );
        return;
      }
      intro("stack recommend");
      console.log(
        colors.dim(
          "  Usage: stack recommend \"B2B SaaS with auth, AI, and payments\"\n",
        ),
      );
      outro("No query — nothing to recommend.");
      return;
    }

    const k = Number.parseInt(String(args.k ?? "6"), 10);
    const categories = args.category ? [String(args.category)] : undefined;
    const hits = retrieve(query, {
      k: Number.isFinite(k) && k > 0 ? k : 6,
      categories: categories as RetrievalHit["provider"]["category"][] | undefined,
    });

    let synthOutcome: Awaited<ReturnType<typeof trySynth>> = null;
    if (args.synth && hits.length > 0) {
      synthOutcome = await trySynth(query, hits);
    }

    const outputHits: RecommendOutputHit[] = hits.map((h) =>
      toOutputHit(h, synthOutcome?.rationales.get(h.provider.name)),
    );

    let recipeInfo: RecommendOutput["recipe"];
    if (args.save && hits.length > 0) {
      const guidance = buildGuidance(hits, [...PROVIDER_CATEGORIES]);
      const recipe: Recipe = recipeFromRetrieval(query, hits, guidance);
      // Prefer synth-authored rationales over raw matched-term strings.
      if (synthOutcome) {
        recipe.providers = recipe.providers.map((p) => ({
          ...p,
          rationale: synthOutcome!.rationales.get(p.name) ?? p.rationale,
        }));
      }
      const path = await writeRecipe(recipe);
      recipeInfo = { id: recipe.id, path };
    }

    const payload: RecommendOutput = {
      query,
      hits: outputHits,
      byCategory: Object.fromEntries(
        Object.entries(retrieveByCategory(query, { k: 20 })).map(([cat, catHits]) => [
          cat,
          catHits.map((h) => ({
            name: h.provider.name,
            score: Number(h.score.toFixed(3)),
          })),
        ]),
      ),
      guidance: buildGuidance(hits, [...PROVIDER_CATEGORIES]),
      recipe: recipeInfo,
      inference: synthOutcome
        ? { mode: synthOutcome.mode, backend: synthOutcome.backend, note: synthOutcome.note }
        : undefined,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    intro("stack recommend");
    console.log(colors.dim(`  query: ${query}\n`));
    if (hits.length === 0) {
      console.log(colors.yellow("  No strong matches.") + "\n");
      console.log(colors.dim(`  ${payload.guidance}\n`));
      outro("Try a more specific query.");
      return;
    }
    for (const hit of outputHits) {
      const scoreTag = colors.dim(`(${hit.score.toFixed(2)})`);
      console.log(
        `  ${colors.green("●")} ${colors.bold(hit.displayName)}  ${colors.cyan(hit.category)}  ${scoreTag}`,
      );
      console.log(`    ${colors.dim(hit.blurb)}`);
      if (hit.rationale) {
        console.log(`    ${colors.dim("why:")} ${hit.rationale}`);
      }
      console.log(
        `    ${colors.dim("add with:")} ${colors.reset("stack add ")}${hit.name}`,
      );
      console.log();
    }
    if (synthOutcome?.note) {
      console.log(colors.dim(`  notes: ${synthOutcome.note}\n`));
    }
    console.log(colors.dim(`  ${payload.guidance}`));
    if (recipeInfo) {
      console.log();
      console.log(
        colors.dim("  Saved recipe:") +
          ` ${colors.bold(recipeInfo.id)}   ` +
          colors.dim(`(${recipeInfo.path})`),
      );
      console.log(
        colors.dim("  Apply with:  ") + colors.reset(`stack apply ${recipeInfo.id}`),
      );
    } else if (!args.json) {
      console.log();
      console.log(
        colors.dim("  Tip: rerun with `--save` to freeze as a recipe for `stack apply`."),
      );
    }
    outro("Tell Claude or run `stack add <name>` to continue.");
  },
});
