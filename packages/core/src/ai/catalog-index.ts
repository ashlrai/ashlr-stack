/**
 * Lightweight retrieval index over the provider catalog.
 *
 * Given a free-text query (e.g. "B2B SaaS with auth + payments + AI"), return
 * the most relevant providers ranked by a BM25-like score over weighted fields.
 *
 * Deliberately zero-dep — 27 curated providers is small enough that a naive
 * in-memory scorer is faster and simpler than bringing in an embedding store.
 * If relevance quality becomes a bottleneck, swap `scoreProvider` for a
 * vector-based retriever; the index/retrieve surface stays the same.
 */

import { PROVIDERS_REF, type ProviderRef } from "../catalog.ts";

export interface RetrievalHit {
  provider: ProviderRef;
  score: number;
  /** Matched query terms (after normalization + synonym expansion). */
  matched: string[];
}

const FIELD_WEIGHTS = {
  name: 4,
  displayName: 3.5,
  blurb: 2.2,
  category: 2.0,
  secrets: 0.8,
  mcp: 1,
  howTo: 0.6,
  notes: 0.5,
} as const;

type FieldName = keyof typeof FIELD_WEIGHTS;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "has", "have", "he", "i", "if", "in", "into", "is", "it", "its", "me",
  "my", "need", "of", "on", "or", "some", "such", "that", "the", "their",
  "then", "there", "these", "they", "this", "to", "us", "want", "was",
  "we", "were", "will", "with", "you", "your", "build", "building", "make",
  "making", "use", "using", "app", "apps", "application", "project",
]);

/**
 * Expand common dev synonyms so everyday phrasing matches curated metadata.
 * Keep this list tight — false positives are worse than a missed synonym
 * because they drown out the correct provider.
 */
const SYNONYMS: Record<string, string[]> = {
  db: ["database"],
  dbs: ["database"],
  postgres: ["database", "postgres", "sql"],
  postgresql: ["database", "postgres", "sql"],
  sqlite: ["database", "sqlite"],
  mysql: ["database", "sql"],
  redis: ["database", "cache"],
  cache: ["database", "cache", "redis"],
  authentication: ["auth"],
  login: ["auth"],
  users: ["auth"],
  payment: ["payments", "billing"],
  billing: ["payments", "billing"],
  subscription: ["payments", "billing"],
  subscriptions: ["payments", "billing"],
  checkout: ["payments"],
  llm: ["ai"],
  llms: ["ai"],
  model: ["ai"],
  models: ["ai"],
  chatbot: ["ai"],
  agent: ["ai"],
  agents: ["ai"],
  gpt: ["ai", "openai"],
  claude: ["ai", "anthropic"],
  grok: ["ai", "xai"],
  frontend: ["deploy"],
  hosting: ["deploy"],
  host: ["deploy"],
  deploy: ["deploy"],
  deployment: ["deploy"],
  monitoring: ["errors"],
  monitor: ["errors"],
  observability: ["errors", "analytics"],
  logs: ["errors"],
  tracking: ["errors", "analytics"],
  metrics: ["analytics"],
  events: ["analytics"],
  ticket: ["tickets"],
  tickets: ["tickets"],
  issues: ["tickets"],
  issue: ["tickets"],
  email: ["email"],
  transactional: ["email"],
  mail: ["email"],
  edge: ["edge", "deploy"],
  serverless: ["serverless", "deploy"],
  kv: ["database"],
  saas: [],
  b2b: [],
  b2c: [],
};

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

function expandQuery(tokens: string[]): string[] {
  const expanded = new Set<string>(tokens);
  for (const tok of tokens) {
    const syns = SYNONYMS[tok];
    if (!syns) continue;
    for (const s of syns) expanded.add(s);
  }
  return [...expanded];
}

interface IndexedProvider {
  provider: ProviderRef;
  fields: Record<FieldName, string[]>;
}

function indexProvider(p: ProviderRef): IndexedProvider {
  const mcpText = p.mcp ? `${p.mcp.name} ${p.mcp.detail}` : "";
  return {
    provider: p,
    fields: {
      name: tokenize(p.name),
      displayName: tokenize(p.displayName),
      category: tokenize(p.category),
      secrets: p.secrets.flatMap(tokenize),
      blurb: tokenize(p.blurb),
      mcp: tokenize(mcpText),
      howTo: tokenize(p.howTo),
      notes: tokenize(p.notes ?? ""),
    },
  };
}

let INDEX_CACHE: IndexedProvider[] | null = null;
let IDF_CACHE: Map<string, number> | null = null;

function getIndex(): IndexedProvider[] {
  if (!INDEX_CACHE) {
    INDEX_CACHE = PROVIDERS_REF.map(indexProvider);
    IDF_CACHE = buildIdf(INDEX_CACHE);
  }
  return INDEX_CACHE;
}

function buildIdf(index: IndexedProvider[]): Map<string, number> {
  const N = index.length;
  const df = new Map<string, number>();
  for (const idx of index) {
    const seen = new Set<string>();
    for (const field of Object.keys(FIELD_WEIGHTS) as FieldName[]) {
      for (const t of idx.fields[field]) seen.add(t);
    }
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idfMap = new Map<string, number>();
  for (const [term, n] of df) {
    // Smoothed IDF (classic BM25): rare terms get big weight, common terms ≈ 0.
    idfMap.set(term, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }
  return idfMap;
}

function idf(term: string): number {
  // Default ≈ IDF of a term appearing in 1 doc out of N — unknown terms still
  // contribute, but less than a known rare term would.
  const N = PROVIDERS_REF.length;
  return IDF_CACHE?.get(term) ?? Math.log(1 + (N + 0.5) / 1.5);
}

function scoreProvider(idx: IndexedProvider, qTokens: string[]): { score: number; matched: string[] } {
  let score = 0;
  const matched = new Set<string>();
  for (const token of qTokens) {
    const tokenIdf = idf(token);
    for (const field of Object.keys(FIELD_WEIGHTS) as FieldName[]) {
      const terms = idx.fields[field];
      let tf = 0;
      for (const t of terms) if (t === token) tf += 1;
      if (tf === 0) continue;
      // Saturating TF: first hit weighted full, diminishing returns after.
      const saturated = tf / (tf + 0.5);
      score += FIELD_WEIGHTS[field] * saturated * tokenIdf;
      matched.add(token);
    }
  }
  return { score, matched: [...matched] };
}

export interface RetrieveOptions {
  /** Max results to return (default 6). */
  k?: number;
  /** Categories to restrict results to, e.g. ["Database", "Auth"]. */
  categories?: ProviderRef["category"][];
  /** Minimum score threshold (default 0.5 — below this we treat as non-match). */
  minScore?: number;
}

/**
 * Retrieve top-k relevant providers for a free-text query.
 *
 * Returns hits sorted by score descending. If no hits clear `minScore`, returns
 * an empty array — callers should treat that as "no confident match" and
 * either fall back to showing all providers or prompt the user to refine.
 */
export function retrieve(query: string, opts: RetrieveOptions = {}): RetrievalHit[] {
  const k = opts.k ?? 6;
  const minScore = opts.minScore ?? 0.5;
  const rawTokens = tokenize(query);
  const qTokens = expandQuery(rawTokens);
  if (qTokens.length === 0) return [];

  const candidates = opts.categories?.length
    ? getIndex().filter((idx) => opts.categories!.includes(idx.provider.category))
    : getIndex();

  const hits: RetrievalHit[] = [];
  for (const idx of candidates) {
    const { score, matched } = scoreProvider(idx, qTokens);
    if (score >= minScore) {
      hits.push({ provider: idx.provider, score, matched });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, k);
}

/**
 * Group the top hits by category. Handy for the MCP tool response shape —
 * Claude can reason over "one from each category" instead of a flat list.
 */
export function retrieveByCategory(query: string, opts: RetrieveOptions = {}): Record<string, RetrievalHit[]> {
  const hits = retrieve(query, { ...opts, k: opts.k ?? 20 });
  const grouped: Record<string, RetrievalHit[]> = {};
  for (const hit of hits) {
    (grouped[hit.provider.category] ??= []).push(hit);
  }
  return grouped;
}

/** Reset the in-memory index. Used by tests. */
export function __resetIndex(): void {
  INDEX_CACHE = null;
  IDF_CACHE = null;
}
