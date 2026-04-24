import type { APIRoute } from "astro";
import {
  type RetrievalHit,
  retrieve,
  retrieveByCategory,
} from "../../../../core/src/ai/catalog-index";
import { PROVIDER_CATEGORIES } from "../../../../core/src/catalog";

/**
 * /api/recommend
 *
 * Mirror of the `stack recommend --json` CLI output. Accepts a natural-language
 * project description and returns the top-k provider hits plus guidance.
 *
 * Pure retrieval: no auth, no secrets, no IO beyond the bundled catalog. The
 * same `retrieve()` is callable client-side too (see StackBuilder / StackREPL),
 * so this route is redundant on a static deploy — but it's defined so a future
 * adapter (or a client that prefers POST) has a server surface to call.
 *
 * NOTE: the current site deploy is static (no Astro adapter configured), so
 * only GET is prerendered. The GET emits the full catalog-retrieval surface
 * for a fixed sample query; POST handlers only fire once a server adapter
 * (e.g. @astrojs/vercel) is added. StackBuilder already catches fetch failure
 * and falls back to an in-process retrieve() call, so the client path works
 * on both static and server deploys.
 */
export const prerender = true;

interface RecommendRequestBody {
  query?: unknown;
  k?: unknown;
  category?: unknown;
}

interface RecommendOutputHit {
  name: string;
  displayName: string;
  category: string;
  authKind: string;
  secrets: string[];
  blurb: string;
  score: number;
  matched: string[];
}

interface RecommendOutput {
  query: string;
  hits: RecommendOutputHit[];
  byCategory: Record<string, Array<{ name: string; score: number }>>;
  guidance: string;
}

function toOutputHit(hit: RetrievalHit): RecommendOutputHit {
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
  const parts = [`Top pick per category: ${topByCat.join(", ")}.`];
  if (missing.length > 0) {
    parts.push(
      `No matches surfaced for: ${missing.join(", ")}. Add terms for those categories if the user needs them.`,
    );
  }
  parts.push(
    `Apply a chosen set with: stack add ${hits
      .slice(0, 3)
      .map((h) => h.provider.name)
      .join(" ")} (or supply your own list).`,
  );
  return parts.join(" ");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const GET: APIRoute = async () => {
  return json({
    endpoint: "/api/recommend",
    method: "POST",
    body: { query: "string", k: "number (1..20, default 6)", category: "string?" },
    note: "POST this endpoint with a JSON body to get provider recommendations. The shape mirrors `stack recommend --json`. Server-side execution requires an Astro server adapter; the client-side SPA calls retrieve() directly if this endpoint is unavailable.",
  });
};

export const POST: APIRoute = async ({ request }) => {
  let body: RecommendRequestBody;
  try {
    body = (await request.json()) as RecommendRequestBody;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return json({ error: "Missing or empty `query`." }, 400);
  }

  // Hard cap k for safety.
  const rawK = typeof body.k === "number" ? body.k : Number.parseInt(String(body.k ?? "6"), 10);
  const k = Math.min(20, Math.max(1, Number.isFinite(rawK) && rawK > 0 ? rawK : 6));

  const categories =
    typeof body.category === "string" && body.category.length > 0 ? [body.category] : undefined;

  const hits = retrieve(query, {
    k,
    categories: categories as RetrievalHit["provider"]["category"][] | undefined,
  });

  const payload: RecommendOutput = {
    query,
    hits: hits.map(toOutputHit),
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
  };

  return json(payload);
};
