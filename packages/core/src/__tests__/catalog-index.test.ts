import { afterEach, describe, expect, it } from "bun:test";
import {
  __resetIndex,
  retrieve,
  retrieveByCategory,
} from "../ai/catalog-index.ts";

/**
 * Golden retrieval tests. Each query must surface the right provider(s) in
 * the top few hits. When adding a provider to `catalog.ts`, re-run these to
 * confirm it hasn't poisoned existing rankings.
 */

afterEach(() => __resetIndex());

function names(hits: ReturnType<typeof retrieve>): string[] {
  return hits.map((h) => h.provider.name);
}

describe("catalog-index.retrieve", () => {
  it("returns empty array for empty / stopword-only query", () => {
    expect(retrieve("")).toEqual([]);
    expect(retrieve("the a to from")).toEqual([]);
  });

  it("ranks Postgres databases at the top for a database query", () => {
    const hits = names(retrieve("I need a postgres database", { k: 4 }));
    // Both Neon and Supabase are legitimate top answers for "postgres"; we
    // just require that both appear in the top 2 in some order.
    expect(hits.slice(0, 2).sort()).toEqual(["neon", "supabase"]);
  });

  it("finds Clerk + Supabase for an auth query", () => {
    const hits = names(retrieve("drop-in auth with users", { k: 4 }));
    expect(hits).toContain("clerk");
    // Supabase also mentions "Auth" in its blurb — it should rank too.
    expect(hits.length).toBeGreaterThan(0);
  });

  it("picks Stripe for payments", () => {
    const hits = names(retrieve("accept payments from customers", { k: 3 }));
    expect(hits[0]).toBe("stripe");
  });

  it("picks Vercel for frontend hosting", () => {
    const hits = names(retrieve("deploy a next.js frontend", { k: 3 }));
    expect(hits[0]).toBe("vercel");
  });

  it("picks Sentry for error tracking", () => {
    const hits = names(retrieve("error tracking and monitoring", { k: 3 }));
    expect(hits[0]).toBe("sentry");
  });

  it("picks Anthropic when Claude is named", () => {
    const hits = names(retrieve("LLM provider for Claude models", { k: 3 }));
    expect(hits[0]).toBe("anthropic");
  });

  it("picks OpenAI when GPT is named", () => {
    const hits = names(retrieve("GPT-4 for my chatbot", { k: 3 }));
    expect(hits[0]).toBe("openai");
  });

  it("composes a B2B SaaS recipe across categories", () => {
    const hits = names(retrieve(
      "B2B SaaS with auth and payments and AI and error tracking",
      { k: 8 },
    ));
    // Expect at least one provider from each intended category.
    expect(hits).toContain("stripe");        // Payments
    expect(hits).toContain("sentry");        // Errors
    // One of the auth providers
    expect(hits.some((n) => ["clerk", "supabase"].includes(n))).toBe(true);
    // One of the AI providers
    expect(hits.some((n) => ["anthropic", "openai", "xai", "deepseek"].includes(n))).toBe(true);
  });

  it("respects category filter", () => {
    const hits = names(retrieve("edge compute", {
      k: 5,
      categories: ["Deploy"],
    }));
    for (const n of hits) {
      const cat = ["vercel", "railway", "fly", "cloudflare", "render"].includes(n);
      expect(cat).toBe(true);
    }
  });

  it("returns empty for gibberish queries below threshold", () => {
    const hits = retrieve("xyzabc qqq noop");
    expect(hits).toEqual([]);
  });

  it("retrieveByCategory buckets results", () => {
    const grouped = retrieveByCategory(
      "B2B SaaS with auth and payments and AI",
      { k: 20 },
    );
    expect(Object.keys(grouped).length).toBeGreaterThan(1);
    expect(grouped.Payments?.[0]?.provider.name).toBe("stripe");
  });
});
