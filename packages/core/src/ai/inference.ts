/**
 * Unified inference layer for Stack's AI recommender.
 *
 * Two backends, one interface:
 *
 *   1. ClaudeMCPBackend — "detection-only". When Stack runs as an MCP tool
 *      (inside Claude Code), we do NOT call an external LLM ourselves.
 *      Instead we return the catalog + project context as structured data
 *      and let Claude synthesize the Recipe. Stack does not own Anthropic
 *      API keys; those belong to Claude.
 *
 *   2. LocalSLMBackend — when Stack runs standalone (no MCP host), talk to
 *      a local OpenAI-compatible server. Default to LM Studio at :1234,
 *      fall back to Ollama at :11434. Zero remote calls, zero SDKs — raw
 *      `fetch` over `/v1/chat/completions`.
 *
 * Selection is driven by `STACK_MCP_MODE` / `MCP_CLIENT` env vars; the
 * loose coupling keeps the CLI entrypoint dumb and lets the MCP server
 * force-pick its own backend when needed.
 */

import { CircuitBreaker } from "./circuit-breaker.ts";
import { type CostTracker, defaultCostTracker } from "./cost-tracker.ts";

// ── Public types ───────────────────────────────────────────────────────

export interface InferenceRequest {
  /** Original free-text query from the user. */
  query: string;
  /** Serialized catalog hits (name + blurb + howTo) to ground the model. */
  catalogContext: string;
  /** Optional detected project metadata — package.json name, frameworks. */
  projectContext?: {
    pkg?: string;
    frameworks?: string[];
    notes?: string;
  };
}

export interface RecipeProvider {
  /** Provider name matching `catalog.ts` (e.g. "neon", "clerk"). */
  name: string;
  /** Short WHY from the model — shown to the user before apply. */
  rationale: string;
}

export interface RecipeDraft {
  providers: RecipeProvider[];
  notes?: string;
}

export type InferenceMode = "synth" | "mcp-delegated";

export interface InferenceUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface InferenceResult {
  mode: InferenceMode;
  /** Populated when `mode === "synth"`. */
  recipe?: RecipeDraft;
  /** Raw assistant message — handy for debugging / telemetry. */
  raw?: string;
  /** Populated when `mode === "mcp-delegated"`: payload for Claude to synthesize. */
  delegatedPayload?: unknown;
  usage?: InferenceUsage;
}

export interface InferenceBackend {
  /** Stable identifier — "claude-mcp", "lm-studio", "ollama". */
  name: string;
  infer(req: InferenceRequest): Promise<InferenceResult>;
  healthy(): Promise<boolean>;
}

export class NoInferenceBackendError extends Error {
  readonly code = "NO_INFERENCE_BACKEND" as const;
  constructor(
    message: string,
    readonly attempted: string[] = [],
  ) {
    super(message);
    this.name = "NoInferenceBackendError";
  }
}

// ── Claude via MCP backend ─────────────────────────────────────────────

/**
 * The MCP backend never calls an LLM itself — its "inference" step is to
 * hand the grounding payload back to the MCP client (Claude Code). The
 * tool response becomes Claude's synth input.
 */
export class ClaudeMCPBackend implements InferenceBackend {
  readonly name = "claude-mcp";

  async infer(req: InferenceRequest): Promise<InferenceResult> {
    return {
      mode: "mcp-delegated",
      delegatedPayload: {
        query: req.query,
        catalogContext: req.catalogContext,
        projectContext: req.projectContext ?? null,
        // Claude-facing instruction — the MCP tool handler forwards this
        // so the model knows exactly what shape to produce.
        instruction:
          "Using the provided catalogContext, pick 1-5 providers that best satisfy the query. Return a RecipeDraft { providers: [{ name, rationale }], notes? } where each name matches a provider in the catalog.",
      },
    };
  }

  /** MCP backend is always "healthy" — it's just a pass-through. */
  async healthy(): Promise<boolean> {
    return true;
  }
}

// ── Local SLM backend (OpenAI-compatible) ──────────────────────────────

export interface LocalSLMEndpoint {
  name: string;
  /** Base URL ending in `/v1` — we'll POST `/chat/completions`. */
  baseUrl: string;
  /** Model name to pass in the chat payload. */
  model: string;
  /** Optional bearer token. LM Studio + Ollama ignore this; leave blank. */
  apiKey?: string;
}

export interface LocalSLMBackendOptions {
  endpoints?: LocalSLMEndpoint[];
  /** Per-request timeout in ms (default 30s). */
  timeoutMs?: number;
  costTracker?: CostTracker;
  circuitBreakerThreshold?: number;
  circuitBreakerWindowMs?: number;
  /** Override fetch — used by tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

const LM_STUDIO_URL = "http://localhost:1234/v1";
const OLLAMA_URL = "http://localhost:11434/v1";

const DEFAULT_LM_STUDIO: LocalSLMEndpoint = {
  name: "lm-studio",
  baseUrl: process.env.STACK_LM_URL ?? LM_STUDIO_URL,
  model: process.env.STACK_LM_MODEL ?? "local-model",
};

const DEFAULT_OLLAMA: LocalSLMEndpoint = {
  name: "ollama",
  baseUrl: OLLAMA_URL,
  model: process.env.STACK_OLLAMA_MODEL ?? "llama3.1",
};

const SYSTEM_PROMPT = [
  "You are Stack, a CLI that recommends third-party providers for a dev project.",
  "You will be given a catalog excerpt (grounding) and a user query.",
  "Respond with ONLY a JSON object of shape:",
  '{"providers":[{"name":"<catalog-name>","rationale":"<why>"}],"notes":"<optional>"}',
  "Pick 1–5 providers. Every `name` MUST match an entry in the catalog excerpt exactly.",
  "Do not wrap the JSON in markdown fences. Do not add prose before or after.",
].join(" ");

export class LocalSLMBackend implements InferenceBackend {
  readonly name = "local-slm";
  private readonly endpoints: LocalSLMEndpoint[];
  private readonly timeoutMs: number;
  private readonly costTracker: CostTracker;
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly fetchImpl: typeof fetch;
  private lastUsedEndpoint: string | null = null;

  constructor(opts: LocalSLMBackendOptions = {}) {
    this.endpoints = opts.endpoints ?? [DEFAULT_LM_STUDIO, DEFAULT_OLLAMA];
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.costTracker = opts.costTracker ?? defaultCostTracker;
    // `bind` keeps the right receiver without picking up Bun's
    // `fetch.preconnect` augmentation, which is incompatible with our
    // constructor-arg type.
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    for (const ep of this.endpoints) {
      this.breakers.set(
        ep.name,
        new CircuitBreaker({
          threshold: opts.circuitBreakerThreshold ?? 3,
          windowMs: opts.circuitBreakerWindowMs ?? 60_000,
        }),
      );
      // Local backends are free — register explicit zero rate so future
      // non-local endpoints that reuse this tracker can't accidentally
      // inherit our "it's free" assumption.
      this.costTracker.setRate(ep.name, { inputPer1M: 0, outputPer1M: 0 });
    }
  }

  /** Endpoint used by the most recent successful `infer` call. */
  get lastEndpoint(): string | null {
    return this.lastUsedEndpoint;
  }

  async healthy(): Promise<boolean> {
    for (const ep of this.endpoints) {
      if (await this.pingEndpoint(ep)) return true;
    }
    return false;
  }

  async infer(req: InferenceRequest): Promise<InferenceResult> {
    const attempted: string[] = [];
    let lastError: Error | null = null;

    for (const ep of this.endpoints) {
      const breaker = this.breakers.get(ep.name);
      if (!breaker) continue; // unreachable — constructor seeds a breaker per endpoint
      if (!breaker.canRequest()) {
        attempted.push(`${ep.name} (circuit-open)`);
        continue;
      }
      attempted.push(ep.name);
      try {
        const result = await this.callEndpoint(ep, req);
        breaker.recordSuccess();
        this.lastUsedEndpoint = ep.name;
        return result;
      } catch (err) {
        breaker.recordFailure();
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw new NoInferenceBackendError(
      `No local inference endpoint reachable${lastError ? ` (last error: ${lastError.message})` : ""}`,
      attempted,
    );
  }

  private async callEndpoint(
    ep: LocalSLMEndpoint,
    req: InferenceRequest,
  ): Promise<InferenceResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const userPrompt = buildUserPrompt(req);
    const body = {
      model: ep.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      stream: false,
    };

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (ep.apiKey) headers.authorization = `Bearer ${ep.apiKey}`;

    let res: Response;
    try {
      res = await this.fetchImpl(`${ep.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`${ep.name} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as ChatCompletionResponse;
    const raw = json.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      throw new Error(`${ep.name} returned empty assistant message`);
    }
    const recipe = parseRecipeDraft(raw);

    const inputTokens = json.usage?.prompt_tokens ?? estimateTokens(userPrompt);
    const outputTokens = json.usage?.completion_tokens ?? estimateTokens(raw);
    const usageRecord = this.costTracker.recordUsage(ep.name, inputTokens, outputTokens);

    return {
      mode: "synth",
      recipe,
      raw,
      usage: {
        inputTokens,
        outputTokens,
        costUsd: usageRecord.costUsd,
      },
    };
  }

  private async pingEndpoint(ep: LocalSLMEndpoint): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const res = await this.fetchImpl(`${ep.baseUrl}/models`, {
        method: "GET",
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Selection ──────────────────────────────────────────────────────────

export interface GetInferenceBackendOptions {
  /** Force local even when MCP env vars are set. */
  preferLocal?: boolean;
  /** Injected for tests. */
  env?: Record<string, string | undefined>;
  localOptions?: LocalSLMBackendOptions;
}

function isMcpMode(env: Record<string, string | undefined>): boolean {
  return Boolean(env.STACK_MCP_MODE || env.MCP_CLIENT);
}

/**
 * Pick the right backend for the current process.
 *
 * Decision order:
 *   1. `preferLocal` — always local (CLI `stack recommend --local` path).
 *   2. MCP env vars set → Claude delegated mode.
 *   3. Otherwise → local SLM (fail loudly if unreachable).
 *
 * We eagerly health-check the local path so that callers get a typed
 * `NoInferenceBackendError` up front rather than a cryptic fetch error
 * deep inside the inference call.
 */
export async function getInferenceBackend(
  opts: GetInferenceBackendOptions = {},
): Promise<InferenceBackend> {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);

  if (!opts.preferLocal && isMcpMode(env)) {
    return new ClaudeMCPBackend();
  }

  const local = new LocalSLMBackend(opts.localOptions);
  if (!(await local.healthy())) {
    throw new NoInferenceBackendError(
      `No local inference endpoint reachable. Start LM Studio (${LM_STUDIO_URL.replace("/v1", "")}) or Ollama (${OLLAMA_URL.replace("/v1", "")}), or run Stack inside Claude Code (MCP mode).`,
      (opts.localOptions?.endpoints ?? [DEFAULT_LM_STUDIO, DEFAULT_OLLAMA]).map((e) => e.name),
    );
  }
  return local;
}

// ── Helpers ────────────────────────────────────────────────────────────

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function buildUserPrompt(req: InferenceRequest): string {
  const parts: string[] = [];
  parts.push(`Query: ${req.query}`);
  if (req.projectContext) {
    parts.push(`Project context: ${JSON.stringify(req.projectContext)}`);
  }
  parts.push("Catalog excerpt:");
  parts.push(req.catalogContext);
  parts.push(
    'Respond with JSON only — shape: {"providers":[{"name":"","rationale":""}],"notes":""}',
  );
  return parts.join("\n\n");
}

/**
 * Extract the first JSON object from an assistant message. Small SLMs often
 * wrap output in ```json fences or pad with prose despite instructions —
 * be tolerant without falling back to `eval`.
 */
export function parseRecipeDraft(raw: string): RecipeDraft {
  const candidate = extractJsonObject(raw);
  if (!candidate) {
    throw new Error("Inference response did not contain a JSON object");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new Error(`Inference response was not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Inference response JSON was not an object");
  }
  const obj = parsed as Record<string, unknown>;
  const providersRaw = obj.providers;
  if (!Array.isArray(providersRaw)) {
    throw new Error("Inference response missing `providers` array");
  }
  const providers: RecipeProvider[] = [];
  for (const entry of providersRaw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const rationale = typeof e.rationale === "string" ? e.rationale.trim() : "";
    if (!name) continue;
    providers.push({ name, rationale });
  }
  if (providers.length === 0) {
    throw new Error("Inference response contained no usable providers");
  }
  const notes = typeof obj.notes === "string" ? obj.notes : undefined;
  return { providers, notes };
}

function extractJsonObject(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const scan = fenced?.[1] ?? raw;
  const start = scan.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let isEscaped = false;
  for (let i = start; i < scan.length; i++) {
    const ch = scan.charAt(i);
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === "\\") {
      isEscaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return scan.slice(start, i + 1);
    }
  }
  return null;
}

/** Rough character-based token estimate — used when the server omits usage. */
function estimateTokens(text: string): number {
  // ~4 chars/token is the standard back-of-envelope for English + code.
  return Math.max(1, Math.ceil(text.length / 4));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
