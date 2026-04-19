import { defineCommand } from "citty";
import {
  PROVIDER_CATEGORIES,
  retrieve,
  retrieveByCategory,
  type RetrievalHit,
} from "@ashlr/stack-core";
import { colors, intro, outro } from "../ui.ts";

/**
 * `stack recommend` — given a natural-language description of what the user is
 * building, surface the most relevant providers from the curated catalog.
 *
 * v1.0 scope: retrieval only. No LLM inference in the Stack process itself —
 * the AI reasoning happens either:
 *   (a) in Claude Code, when this is invoked via the `stack_recommend` MCP
 *       tool — Claude reads the JSON output and synthesizes a Recipe.
 *   (b) in the local SLM, wired in Phase C (`packages/core/src/ai/inference.ts`).
 *
 * Output modes:
 *   - default: human-readable list, grouped by category
 *   - --json: machine-readable blob (used by the MCP server + site /api)
 */

interface RecommendOutput {
  query: string;
  hits: Array<{
    name: string;
    displayName: string;
    category: string;
    authKind: string;
    secrets: string[];
    blurb: string;
    score: number;
    matched: string[];
  }>;
  byCategory: Record<string, Array<{ name: string; score: number }>>;
  guidance: string;
}

function toOutputHit(hit: RetrievalHit): RecommendOutput["hits"][number] {
  return {
    name: hit.provider.name,
    displayName: hit.provider.displayName,
    category: hit.provider.category,
    authKind: hit.provider.authKind,
    secrets: hit.provider.secrets,
    blurb: hit.provider.blurb,
    score: Number(hit.score.toFixed(3)),
    matched: hit.matched,
  };
}

function buildGuidance(hits: RetrievalHit[], categories: string[]): string {
  if (hits.length === 0) {
    return "No strong matches. Try describing the concrete capability you need (e.g. 'postgres database', 'stripe subscriptions', 'deploy frontend').";
  }
  const covered = new Set(hits.map((h) => h.provider.category));
  const missing = categories.filter((c) => !covered.has(c as (typeof PROVIDER_CATEGORIES)[number]));
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
  const parts = [
    `Top pick per category: ${topByCat.join(", ")}.`,
  ];
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
    const categories = args.category
      ? [String(args.category)]
      : undefined;
    const hits = retrieve(query, {
      k: Number.isFinite(k) && k > 0 ? k : 6,
      categories: categories as RetrievalHit["provider"]["category"][] | undefined,
    });

    const payload: RecommendOutput = {
      query,
      hits: hits.map(toOutputHit),
      byCategory: Object.fromEntries(
        Object.entries(retrieveByCategory(query, { k: 20 })).map(([cat, catHits]) => [
          cat,
          catHits.map((h) => ({ name: h.provider.name, score: Number(h.score.toFixed(3)) })),
        ]),
      ),
      guidance: buildGuidance(hits, [...PROVIDER_CATEGORIES]),
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
    for (const hit of hits) {
      const scoreTag = colors.dim(`(${hit.score.toFixed(2)})`);
      console.log(
        `  ${colors.green("●")} ${colors.bold(hit.provider.displayName)}  ${colors.cyan(hit.provider.category)}  ${scoreTag}`,
      );
      console.log(`    ${colors.dim(hit.provider.blurb)}`);
      console.log(
        `    ${colors.dim("add with:")} ${colors.reset("stack add ")}${hit.provider.name}`,
      );
      console.log();
    }
    console.log(colors.dim(`  ${payload.guidance}`));
    outro("Tell Claude or run `stack add <name>` to continue.");
  },
});
