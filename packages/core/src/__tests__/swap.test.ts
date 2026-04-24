import { describe, expect, it } from "bun:test";
import { SWAP_PAIRS, findSwap, suggestSwaps } from "../swap.ts";

describe("findSwap", () => {
  it("finds a registered pair", () => {
    const pair = findSwap("clerk", "auth0");
    expect(pair).toBeDefined();
    expect(pair?.from).toBe("clerk");
    expect(pair?.to).toBe("auth0");
  });

  it("finds the reverse direction", () => {
    const pair = findSwap("auth0", "clerk");
    expect(pair).toBeDefined();
    expect(pair?.from).toBe("auth0");
    expect(pair?.to).toBe("clerk");
  });

  it("returns undefined for an unknown pair", () => {
    expect(findSwap("clerk", "stripe")).toBeUndefined();
    expect(findSwap("openai", "anthropic")).toBeUndefined();
  });

  it("finds supabase → neon with DATABASE_URL alias", () => {
    const pair = findSwap("supabase", "neon");
    expect(pair).toBeDefined();
    expect(pair?.aliases).toBeDefined();
    expect(pair?.aliases?.DATABASE_URL).toBe("SUPABASE_URL");
  });

  it("finds neon → supabase", () => {
    const pair = findSwap("neon", "supabase");
    expect(pair).toBeDefined();
  });

  it("finds all email provider pairs both ways", () => {
    const emailProviders = ["resend", "sendgrid", "mailgun", "postmark"];
    for (const a of emailProviders) {
      for (const b of emailProviders) {
        if (a === b) continue;
        const pair = findSwap(a, b);
        expect(pair).toBeDefined();
      }
    }
  });

  it("finds all analytics provider pairs both ways", () => {
    const analytics = ["posthog", "mixpanel", "plausible"];
    for (const a of analytics) {
      for (const b of analytics) {
        if (a === b) continue;
        expect(findSwap(a, b)).toBeDefined();
      }
    }
  });

  it("finds datadog ↔ grafana", () => {
    expect(findSwap("datadog", "grafana")).toBeDefined();
    expect(findSwap("grafana", "datadog")).toBeDefined();
  });

  it("finds all deploy provider pairs", () => {
    const deploy = ["vercel", "railway", "fly", "render"];
    for (const a of deploy) {
      for (const b of deploy) {
        if (a === b) continue;
        expect(findSwap(a, b)).toBeDefined();
      }
    }
  });
});

describe("suggestSwaps", () => {
  it("returns auth category peers for clerk", () => {
    const suggestions = suggestSwaps("clerk");
    expect(suggestions).toContain("auth0");
    expect(suggestions).toContain("workos");
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
  });

  it("returns email peers for resend", () => {
    const suggestions = suggestSwaps("resend");
    expect(suggestions).toContain("sendgrid");
    expect(suggestions).toContain("mailgun");
    expect(suggestions).toContain("postmark");
  });

  it("returns empty array for a provider with no swaps", () => {
    expect(suggestSwaps("stripe")).toEqual([]);
    expect(suggestSwaps("github")).toEqual([]);
  });

  it("returns deploy peers for vercel", () => {
    const suggestions = suggestSwaps("vercel");
    expect(suggestions).toContain("railway");
    expect(suggestions).toContain("fly");
    expect(suggestions).toContain("render");
  });
});

describe("SWAP_PAIRS", () => {
  it("contains no duplicate from/to combinations", () => {
    const seen = new Set<string>();
    for (const pair of SWAP_PAIRS) {
      const key = `${pair.from}→${pair.to}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("has at least 30 pairs covering all categories", () => {
    expect(SWAP_PAIRS.length).toBeGreaterThanOrEqual(30);
  });
});
