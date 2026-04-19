import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ClaudeMCPBackend,
  LocalSLMBackend,
  NoInferenceBackendError,
  getInferenceBackend,
  parseRecipeDraft,
} from "../ai/inference.ts";
import { CostTracker } from "../ai/cost-tracker.ts";

/**
 * Inference backend tests. The local backend talks to an OpenAI-compatible
 * HTTP API, so every test either injects a fake `fetchImpl` or monkey-patches
 * `globalThis.fetch`. We never hit the network.
 */

// Minimal valid chat-completion response.
function okChatResponse(content: string, usage?: { prompt_tokens?: number; completion_tokens?: number }) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const VALID_RECIPE_JSON = JSON.stringify({
  providers: [
    { name: "neon", rationale: "Managed Postgres with branching" },
    { name: "clerk", rationale: "Drop-in auth UI" },
  ],
  notes: "Add Stripe later if billing shows up",
});

describe("getInferenceBackend — selection", () => {
  test("STACK_MCP_MODE=1 selects ClaudeMCPBackend", async () => {
    const backend = await getInferenceBackend({
      env: { STACK_MCP_MODE: "1" },
    });
    expect(backend.name).toBe("claude-mcp");
    expect(backend).toBeInstanceOf(ClaudeMCPBackend);
  });

  test("MCP_CLIENT set selects ClaudeMCPBackend", async () => {
    const backend = await getInferenceBackend({
      env: { MCP_CLIENT: "claude-code" },
    });
    expect(backend.name).toBe("claude-mcp");
  });

  test("no MCP env + reachable LM Studio → LocalSLMBackend", async () => {
    const backend = await getInferenceBackend({
      env: {},
      localOptions: {
        endpoints: [{ name: "lm-studio-fake", baseUrl: "http://fake/v1", model: "x" }],
        fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      },
    });
    expect(backend.name).toBe("local-slm");
    expect(backend).toBeInstanceOf(LocalSLMBackend);
  });

  test("preferLocal=true overrides MCP mode", async () => {
    const backend = await getInferenceBackend({
      preferLocal: true,
      env: { STACK_MCP_MODE: "1" },
      localOptions: {
        endpoints: [{ name: "lm-studio-fake", baseUrl: "http://fake/v1", model: "x" }],
        fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      },
    });
    expect(backend.name).toBe("local-slm");
  });

  test("local backend with both endpoints unreachable throws NoInferenceBackendError", async () => {
    await expect(
      getInferenceBackend({
        env: {},
        localOptions: {
          endpoints: [
            { name: "lm-studio-fake", baseUrl: "http://127.0.0.1:1/v1", model: "x" },
            { name: "ollama-fake", baseUrl: "http://127.0.0.1:2/v1", model: "y" },
          ],
          fetchImpl: (async () => {
            throw new Error("ECONNREFUSED");
          }) as unknown as typeof fetch,
        },
      }),
    ).rejects.toBeInstanceOf(NoInferenceBackendError);
  });
});

describe("ClaudeMCPBackend", () => {
  test("infer returns mcp-delegated mode with the grounding payload", async () => {
    const backend = new ClaudeMCPBackend();
    const result = await backend.infer({
      query: "payments + auth",
      catalogContext: "stripe — payments\nclerk — auth",
      projectContext: { pkg: "my-app", frameworks: ["next"] },
    });
    expect(result.mode).toBe("mcp-delegated");
    expect(result.recipe).toBeUndefined();
    expect(result.delegatedPayload).toBeDefined();
    const payload = result.delegatedPayload as Record<string, unknown>;
    expect(payload.query).toBe("payments + auth");
    expect(payload.catalogContext).toContain("stripe");
    expect(payload.projectContext).toEqual({ pkg: "my-app", frameworks: ["next"] });
  });

  test("healthy resolves true without network", async () => {
    expect(await new ClaudeMCPBackend().healthy()).toBe(true);
  });
});

describe("LocalSLMBackend — infer", () => {
  test("happy path — parses recipe + records usage with reported tokens", async () => {
    const costTracker = new CostTracker();
    const fetchImpl = (async () =>
      okChatResponse(VALID_RECIPE_JSON, { prompt_tokens: 120, completion_tokens: 45 })) as unknown as typeof fetch;

    const backend = new LocalSLMBackend({
      endpoints: [{ name: "lm-studio-fake", baseUrl: "http://fake/v1", model: "test" }],
      costTracker,
      fetchImpl,
    });

    const result = await backend.infer({
      query: "postgres + auth",
      catalogContext: "neon — Postgres\nclerk — auth",
    });

    expect(result.mode).toBe("synth");
    expect(result.recipe?.providers.map((p) => p.name)).toEqual(["neon", "clerk"]);
    expect(result.usage?.inputTokens).toBe(120);
    expect(result.usage?.outputTokens).toBe(45);
    expect(result.usage?.costUsd).toBe(0);
    expect(backend.lastEndpoint).toBe("lm-studio-fake");

    const summary = costTracker.getSummary();
    expect(summary.totalInputTokens).toBe(120);
    expect(summary.totalOutputTokens).toBe(45);
    expect(summary.totalCostUsd).toBe(0);
  });

  test("falls back to the second endpoint when the first fails", async () => {
    let call = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      call++;
      if (url.includes("primary")) {
        throw new Error("ECONNREFUSED");
      }
      return okChatResponse(VALID_RECIPE_JSON);
    }) as unknown as typeof fetch;

    const backend = new LocalSLMBackend({
      endpoints: [
        { name: "primary", baseUrl: "http://primary/v1", model: "a" },
        { name: "secondary", baseUrl: "http://secondary/v1", model: "b" },
      ],
      fetchImpl,
      costTracker: new CostTracker(),
    });

    const result = await backend.infer({ query: "x", catalogContext: "" });
    expect(result.mode).toBe("synth");
    expect(backend.lastEndpoint).toBe("secondary");
    expect(call).toBeGreaterThanOrEqual(2);
  });

  test("throws NoInferenceBackendError when every endpoint fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;

    const backend = new LocalSLMBackend({
      endpoints: [
        { name: "a", baseUrl: "http://a/v1", model: "m" },
        { name: "b", baseUrl: "http://b/v1", model: "m" },
      ],
      fetchImpl,
      costTracker: new CostTracker(),
    });

    await expect(backend.infer({ query: "x", catalogContext: "" })).rejects.toBeInstanceOf(
      NoInferenceBackendError,
    );
  });

  test("circuit breaker opens after 3 consecutive failures and rejects immediately", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      throw new Error("boom");
    }) as unknown as typeof fetch;

    // Single-endpoint backend so the breaker state is easy to reason about.
    const backend = new LocalSLMBackend({
      endpoints: [{ name: "solo", baseUrl: "http://solo/v1", model: "m" }],
      fetchImpl,
      costTracker: new CostTracker(),
      circuitBreakerThreshold: 3,
      // Long reset — once open, stays open for the remainder of the test.
      circuitBreakerWindowMs: 60_000,
    });

    for (let i = 0; i < 3; i++) {
      await expect(backend.infer({ query: "x", catalogContext: "" })).rejects.toBeInstanceOf(
        NoInferenceBackendError,
      );
    }
    const callsAfterTrip = calls;
    // Fourth call should short-circuit — no new fetch attempt.
    await expect(backend.infer({ query: "x", catalogContext: "" })).rejects.toBeInstanceOf(
      NoInferenceBackendError,
    );
    expect(calls).toBe(callsAfterTrip);
  });

  test("rejects non-2xx with a readable error message", async () => {
    const fetchImpl = (async () =>
      new Response("model not loaded", { status: 503 })) as unknown as typeof fetch;

    const backend = new LocalSLMBackend({
      endpoints: [{ name: "solo", baseUrl: "http://solo/v1", model: "m" }],
      fetchImpl,
      costTracker: new CostTracker(),
    });

    await expect(
      backend.infer({ query: "x", catalogContext: "" }),
    ).rejects.toBeInstanceOf(NoInferenceBackendError);
  });

  test("healthy pings /models and returns true when any endpoint responds", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/models")) return new Response("[]", { status: 200 });
      return new Response("", { status: 500 });
    }) as unknown as typeof fetch;

    const backend = new LocalSLMBackend({
      endpoints: [{ name: "solo", baseUrl: "http://solo/v1", model: "m" }],
      fetchImpl,
    });
    expect(await backend.healthy()).toBe(true);
  });
});

describe("parseRecipeDraft", () => {
  test("parses plain JSON", () => {
    const draft = parseRecipeDraft(VALID_RECIPE_JSON);
    expect(draft.providers).toHaveLength(2);
    expect(draft.providers[0]!.name).toBe("neon");
  });

  test("tolerates markdown fences", () => {
    const wrapped = "```json\n" + VALID_RECIPE_JSON + "\n```";
    const draft = parseRecipeDraft(wrapped);
    expect(draft.providers).toHaveLength(2);
  });

  test("tolerates leading prose", () => {
    const draft = parseRecipeDraft(
      "Sure! Here's the recipe:\n" + VALID_RECIPE_JSON + "\nLet me know!",
    );
    expect(draft.providers).toHaveLength(2);
  });

  test("throws when the object has no usable providers", () => {
    expect(() => parseRecipeDraft('{"providers":[]}')).toThrow();
  });

  test("throws when the response is not JSON", () => {
    expect(() => parseRecipeDraft("sorry, I can't help with that")).toThrow();
  });
});

describe("CostTracker — math", () => {
  test("zero rate yields $0 even for large token counts", () => {
    const t = new CostTracker();
    t.recordUsage("local", 10_000_000, 5_000_000);
    const s = t.getSummary();
    expect(s.totalInputTokens).toBe(10_000_000);
    expect(s.totalOutputTokens).toBe(5_000_000);
    expect(s.totalCostUsd).toBe(0);
    expect(s.perBackend.local?.calls).toBe(1);
  });

  test("applies per-1M rate card correctly", () => {
    const t = new CostTracker();
    t.setRate("remote", { inputPer1M: 3, outputPer1M: 15 });
    const rec = t.recordUsage("remote", 1_000_000, 500_000);
    // 1M * $3 + 0.5M * $15 = 3 + 7.5 = 10.5
    expect(rec.costUsd).toBeCloseTo(10.5, 6);
    expect(t.getSummary().totalCostUsd).toBeCloseTo(10.5, 6);
  });

  test("aggregates across backends and calls", () => {
    const t = new CostTracker();
    t.setRate("a", { inputPer1M: 1, outputPer1M: 2 });
    t.setRate("b", { inputPer1M: 4, outputPer1M: 8 });
    t.recordUsage("a", 500_000, 500_000); // 0.5 + 1 = 1.5
    t.recordUsage("a", 500_000, 500_000); // +1.5
    t.recordUsage("b", 250_000, 250_000); // 1 + 2 = 3
    const s = t.getSummary();
    expect(s.perBackend.a?.calls).toBe(2);
    expect(s.perBackend.b?.calls).toBe(1);
    expect(s.totalCostUsd).toBeCloseTo(6, 6);
  });
});

// Ensure the global fetch is untouched if any future test forgets to restore.
describe("fetch safety net", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = realFetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  test("globalThis.fetch is restored", () => {
    expect(globalThis.fetch).toBe(realFetch);
  });
});
