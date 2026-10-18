import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LocalSLMBackend, defaultOllamaEndpoint } from "../ai/inference.ts";
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  anthropicBaseUrl,
  ollamaBaseUrl,
  openaiBaseUrl,
} from "../base-urls.ts";
import type { ProviderContext } from "../providers/_base.ts";
import anthropic from "../providers/anthropic.ts";
import openai from "../providers/openai.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("defaults are unchanged", () => {
  test("hosts match what Stack always called", () => {
    expect(DEFAULT_ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    expect(DEFAULT_OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    expect(DEFAULT_OLLAMA_BASE_URL).toBe("http://localhost:11434");
    expect(defaultOllamaEndpoint({}).baseUrl).toBe("http://localhost:11434/v1");
  });
  test("unset, empty and whitespace-only values fall back", () => {
    for (const v of [undefined, "", "   ", "/", " // "]) {
      expect(anthropicBaseUrl({ ANTHROPIC_BASE_URL: v })).toBe(DEFAULT_ANTHROPIC_BASE_URL);
      expect(openaiBaseUrl({ OPENAI_BASE_URL: v })).toBe(DEFAULT_OPENAI_BASE_URL);
      expect(ollamaBaseUrl({ OLLAMA_HOST: v })).toBe(DEFAULT_OLLAMA_BASE_URL);
    }
  });
});

describe("overrides are honored", () => {
  test("anthropic and openai: used as given, trailing slashes trimmed", () => {
    expect(anthropicBaseUrl({ ANTHROPIC_BASE_URL: "http://127.0.0.1:4000" })).toBe(
      "http://127.0.0.1:4000",
    );
    expect(anthropicBaseUrl({ ANTHROPIC_BASE_URL: " https://gw.example/anthropic/// " })).toBe(
      "https://gw.example/anthropic",
    );
    expect(openaiBaseUrl({ OPENAI_BASE_URL: "http://127.0.0.1:4000/v1/" })).toBe(
      "http://127.0.0.1:4000/v1",
    );
  });
  test("ollama host forms", () => {
    expect(ollamaBaseUrl({ OLLAMA_HOST: "192.168.1.5:9999" })).toBe("http://192.168.1.5:9999");
    expect(ollamaBaseUrl({ OLLAMA_HOST: "gpu-box:11435/" })).toBe("http://gpu-box:11435");
    expect(ollamaBaseUrl({ OLLAMA_HOST: "gpu-box" })).toBe("http://gpu-box:11434");
    expect(ollamaBaseUrl({ OLLAMA_HOST: ":8080" })).toBe("http://localhost:8080");
    expect(ollamaBaseUrl({ OLLAMA_HOST: "[::1]:11434" })).toBe("http://[::1]:11434");
    expect(ollamaBaseUrl({ OLLAMA_HOST: "[::1]" })).toBe("http://[::1]:11434");
    expect(ollamaBaseUrl({ OLLAMA_HOST: "https://ollama.example.com/" })).toBe(
      "https://ollama.example.com",
    );
    expect(defaultOllamaEndpoint({ OLLAMA_HOST: "gpu-box" }).baseUrl).toBe(
      "http://gpu-box:11434/v1",
    );
  });
});

describe("callers read the variables at call time", () => {
  const keys = ["ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "OLLAMA_HOST"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  let h: Harness;
  let realFetch: typeof fetch;
  let urls: string[];

  beforeEach(() => {
    // Exercises the HTTP call after a key is read; real Phantom 0.7.9 refuses headless reveal.
    h = setupFakePhantom(
      { ANTHROPIC_API_KEY: "sk-ant-fake", OPENAI_API_KEY: "sk-fake" },
      { legacyHeadlessReveal: true },
    );
    realFetch = globalThis.fetch;
    urls = [];
    globalThis.fetch = (async (u: string | URL | Request) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const entry = (provider: string, secret: string) => ({
    provider,
    secrets: [secret],
    created_at: new Date().toISOString(),
  });

  test("key checks hit the default hosts when unset", async () => {
    for (const k of keys) delete process.env[k];
    expect((await anthropic.healthcheck!(ctx, entry("anthropic", "ANTHROPIC_API_KEY"))).kind).toBe(
      "ok",
    );
    expect((await openai.healthcheck!(ctx, entry("openai", "OPENAI_API_KEY"))).kind).toBe("ok");
    expect(urls).toEqual([
      "https://api.anthropic.com/v1/models",
      "https://api.openai.com/v1/models",
    ]);
  });

  test("key checks follow ANTHROPIC_BASE_URL and OPENAI_BASE_URL", async () => {
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:4000/";
    process.env.OPENAI_BASE_URL = "http://127.0.0.1:4000/v1";
    await anthropic.healthcheck!(ctx, entry("anthropic", "ANTHROPIC_API_KEY"));
    await openai.healthcheck!(ctx, entry("openai", "OPENAI_API_KEY"));
    expect(urls).toEqual(["http://127.0.0.1:4000/v1/models", "http://127.0.0.1:4000/v1/models"]);
  });

  test("the local SLM backend picks up OLLAMA_HOST when constructed", async () => {
    process.env.OLLAMA_HOST = "gpu-box:11435";
    const seen: string[] = [];
    const down = (async (u: string | URL | Request) => {
      seen.push(String(u));
      return new Response("down", { status: 503 });
    }) as unknown as typeof fetch;
    expect(await new LocalSLMBackend({ fetchImpl: down }).healthy()).toBe(false);
    expect(seen).toContain("http://gpu-box:11435/v1/models");
  });
});
