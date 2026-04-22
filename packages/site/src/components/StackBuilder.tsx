import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PROVIDERS, CATEGORIES, type Provider } from "~/lib/providers";
import { PROVIDERS_REF, type ProviderRef } from "~/lib/providers-ref";
import {
  retrieve,
  retrieveByCategory,
  type RetrievalHit,
} from "../../../core/src/ai/catalog-index";
import { PROVIDER_CATEGORIES } from "../../../core/src/catalog";
import CopyBtn from "~/components/primitives/CopyBtn";

/**
 * StackBuilder — the interactive heart of the landing page.
 *
 * Joins the display catalog (providers.ts) with the technical reference
 * (providers-ref.ts) and lets a visitor:
 *   1. Filter providers by category + live search
 *   2. Click a card → inline detail: real `stack add` invocation, env vars,
 *      MCP config entry, dashboard link
 *   3. Multi-select providers → sticky dock at the bottom assembles the full
 *      recipe (.env block, .mcp.json block, one-liner `stack add` batch)
 *   4. Copy every piece independently or copy the full recipe
 */

type Merged = {
  display: Provider;
  ref: ProviderRef | null;
  iconPath: string | null;
};

interface RecommendResponse {
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

const SLUG_TO_REF_NAME: Record<string, string> = {
  supabase: "supabase",
  neon: "neon",
  turso: "turso",
  convex: "convex",
  upstash: "upstash",
  firebase: "firebase",
  vercel: "vercel",
  railway: "railway",
  flydotio: "fly",
  cloudflare: "cloudflare",
  render: "render",
  modal: "modal",
  amazonwebservices: "aws",
  openai: "openai",
  anthropic: "anthropic",
  x: "xai",
  deepseek: "deepseek",
  replicate: "replicate",
  braintrust: "braintrust",
  posthog: "posthog",
  sentry: "sentry",
  stripe: "stripe",
  github: "github",
  linear: "linear",
  resend: "resend",
  clerk: "clerk",
};

function stubRef(p: Provider): ProviderRef {
  const key = p.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
  const secretName = `${key.toUpperCase()}_API_KEY`;
  return {
    name: key,
    displayName: p.name,
    category: p.category,
    authKind: "api_key",
    secrets: [secretName],
    blurb: p.blurb,
    dashboard: "",
    docs: "",
    howTo: "",
  };
}

function mergeCatalog(iconPaths: Record<string, string | null>): Merged[] {
  const byName = new Map(PROVIDERS_REF.map((r) => [r.name, r]));
  return PROVIDERS.map((p) => {
    const refName = SLUG_TO_REF_NAME[p.slug];
    const ref = refName ? byName.get(refName) ?? null : null;
    return { display: p, ref: ref ?? stubRef(p), iconPath: iconPaths[p.slug] ?? null };
  });
}

function formatAuthKind(kind: ProviderRef["authKind"]): string {
  switch (kind) {
    case "oauth_pkce": return "OAuth (PKCE)";
    case "oauth_device": return "OAuth (device)";
    case "pat": return "Personal access token";
    case "api_key": return "API key";
  }
}

function buildEnvBlock(selected: Merged[]): string {
  return selected
    .map((m) => {
      const header = `# ${m.display.name} — ${m.ref?.authKind ? formatAuthKind(m.ref.authKind) : "API key"}`;
      const lines = (m.ref?.secrets ?? []).map((s) => `${s}=<phantom://${m.ref?.name ?? ""}/${s}>`);
      return [header, ...lines].join("\n");
    })
    .join("\n\n");
}

function buildMcpBlock(selected: Merged[]): string {
  const mcpEntries = selected.filter((m) => m.ref?.mcp);
  if (mcpEntries.length === 0) return "";
  const servers: Record<string, unknown> = {};
  for (const m of mcpEntries) {
    if (!m.ref?.mcp) continue;
    servers[m.ref.mcp.name] = {
      command: "stack",
      args: ["mcp", "run", m.ref.mcp.name],
      env: Object.fromEntries((m.ref.secrets ?? []).map((s) => [s, `<phantom://${m.ref!.name}/${s}>`])),
    };
  }
  return JSON.stringify({ mcpServers: servers }, null, 2);
}

function buildBatchCommand(selected: Merged[]): string {
  if (selected.length === 0) return "";
  return `stack add ${selected.map((m) => m.ref?.name ?? m.display.name.toLowerCase()).join(" ")}`;
}

interface CardProps {
  m: Merged;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
}

function ProviderCard({ m, selected, expanded, onToggle, onExpand }: CardProps) {
  const brand = `#${m.display.color}`;
  const hasMcp = Boolean(m.ref?.mcp);
  return (
    <div
      className={`provider-card group relative block panel p-4 transition-all duration-200 ${
        selected ? "ring-1 ring-[color:var(--color-blade-500)]" : ""
      } ${expanded ? "ring-1 ring-[color:var(--color-steel-300)]" : ""}`}
      style={{ ["--brand" as string]: brand }}
    >
      <button
        type="button"
        className="absolute inset-0 w-full h-full cursor-pointer"
        aria-label={`Inspect ${m.display.name}`}
        onClick={onExpand}
      />
      <div className="relative flex items-start justify-between pointer-events-none">
        <div className="w-8 h-8 flex items-center justify-center rounded-md bg-white/5">
          {m.iconPath ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" className="provider-icon text-[color:var(--color-ink-200)] group-hover:text-[color:var(--brand)] transition-colors">
              <path d={m.iconPath} />
            </svg>
          ) : (
            <span className="text-[10px] mono text-[color:var(--color-ink-400)]">{m.display.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {hasMcp && (
            <span className="text-[9px] mono font-semibold tracking-[0.12em] uppercase px-1.5 py-0.5 border border-[color:var(--color-blade-500)] text-[color:var(--color-blade-400)]">
              MCP
            </span>
          )}
          {m.display.keyOnly && (
            <span className="text-[9px] mono tracking-[0.08em] uppercase px-1.5 py-0.5 border border-[color:var(--color-ink-600)] text-[color:var(--color-ink-500)]" title="Key-only · v0.2 adds provisioning">
              key
            </span>
          )}
        </div>
      </div>
      <div className="relative mt-3 pointer-events-none">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white tracking-tight">{m.display.name}</span>
          {m.display.auth && (
            <span className="text-[9px] mono text-[color:var(--color-ink-500)]">· {m.display.auth}</span>
          )}
        </div>
        <div className="text-[11px] text-[color:var(--color-ink-400)] mt-0.5 leading-snug">{m.display.blurb}</div>
      </div>
      <div className="relative mt-3 flex items-center justify-between pointer-events-auto">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className={`mono text-[10px] tracking-[0.14em] uppercase px-2 py-1 border transition-colors ${
            selected
              ? "border-[color:var(--color-blade-500)] bg-[color:var(--color-blade-500)] text-[color:var(--color-ink-950)]"
              : "border-[color:var(--color-steel-500)] text-[color:var(--color-ink-300)] hover:border-[color:var(--color-blade-400)] hover:text-[color:var(--color-blade-400)]"
          }`}
        >
          {selected ? "✓ Added" : "+ Add"}
        </button>
        <span className="mono text-[10px] text-[color:var(--color-ink-500)] group-hover:text-[color:var(--color-blade-400)] transition-colors">
          {expanded ? "close" : "inspect →"}
        </span>
      </div>
    </div>
  );
}

interface DetailProps { m: Merged; onClose: () => void; selected: boolean; onToggle: () => void }
function DetailPanel({ m, onClose, selected, onToggle }: DetailProps) {
  const ref = m.ref;
  if (!ref) return null;
  const cmd = `stack add ${ref.name}`;
  const envSample = ref.secrets.map((s) => `${s}=<phantom://${ref.name}/${s}>`).join("\n");
  const mcpSample = ref.mcp
    ? JSON.stringify(
        {
          mcpServers: {
            [ref.mcp.name]: {
              command: "stack",
              args: ["mcp", "run", ref.mcp.name],
              env: Object.fromEntries(ref.secrets.map((s) => [s, `<phantom://${ref.name}/${s}>`])),
            },
          },
        },
        null,
        2,
      )
    : "";

  return (
    <div className="panel-steel mt-4 p-5 sm:p-6 relative">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-500)] mb-1">
            {ref.category} · {formatAuthKind(ref.authKind)}
            {ref.mcp && <span className="text-[color:var(--color-blade-400)]"> · MCP auto-wired</span>}
          </div>
          <h4 className="text-xl text-[color:var(--color-ink-50)] tracking-tight font-medium">{ref.displayName}</h4>
          <p className="mt-1 text-sm text-[color:var(--color-ink-300)] max-w-[640px]">{ref.blurb}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-400)] hover:text-[color:var(--color-ink-100)]"
          aria-label="Close detail"
        >
          close ✕
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Invocation block */}
        <div className="panel p-3" style={{ borderLeft: "2px solid var(--color-blade-500)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">invocation</span>
            <CopyBtn text={cmd} compact />
          </div>
          <div className="mono text-[13px] text-[color:var(--color-ink-100)]">
            <span className="text-[color:var(--color-blade-400)]">›</span> {cmd}
          </div>
          {ref.howTo && (
            <p className="mt-3 text-[11px] text-[color:var(--color-ink-400)] leading-[1.5]">{ref.howTo}</p>
          )}
        </div>

        {/* Env block */}
        <div className="panel p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">writes to .env</span>
            <CopyBtn text={envSample} compact />
          </div>
          <pre className="mono text-[12px] text-[color:var(--color-ink-200)] leading-[1.5] whitespace-pre-wrap break-all">
            {envSample}
          </pre>
        </div>

        {/* MCP block (if present) */}
        {ref.mcp && (
          <div className="panel p-3 lg:col-span-2" style={{ borderLeft: "2px solid var(--color-blade-500)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">.mcp.json entry</span>
              <CopyBtn text={mcpSample} compact />
            </div>
            <pre className="mono text-[12px] text-[color:var(--color-ink-200)] leading-[1.5] overflow-x-auto">
              {mcpSample}
            </pre>
            <p className="mt-2 text-[11px] text-[color:var(--color-ink-400)] leading-[1.5]">{ref.mcp.detail}</p>
          </div>
        )}

        {/* Dashboard + docs */}
        <div className="panel p-3 lg:col-span-2 flex flex-wrap gap-3 items-center">
          <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">links</span>
          {ref.dashboard && (
            <a href={ref.dashboard} target="_blank" rel="noopener noreferrer" className="mono text-[11px] text-[color:var(--color-ink-200)] hover:text-[color:var(--color-blade-400)] underline decoration-white/20 underline-offset-2">
              dashboard ↗
            </a>
          )}
          {ref.docs && (
            <a href={ref.docs} target="_blank" rel="noopener noreferrer" className="mono text-[11px] text-[color:var(--color-ink-200)] hover:text-[color:var(--color-blade-400)] underline decoration-white/20 underline-offset-2">
              upstream docs ↗
            </a>
          )}
          {ref.notes && (
            <span className="mono text-[10px] text-[color:var(--color-ink-500)]">note: {ref.notes}</span>
          )}
          <div className="ml-auto">
            <button
              type="button"
              onClick={onToggle}
              className={`mono text-[10px] tracking-[0.14em] uppercase px-3 py-1.5 border transition-colors ${
                selected
                  ? "border-[color:var(--color-blade-500)] bg-[color:var(--color-blade-500)] text-[color:var(--color-ink-950)]"
                  : "border-[color:var(--color-steel-500)] text-[color:var(--color-ink-200)] hover:border-[color:var(--color-blade-400)] hover:text-[color:var(--color-blade-400)]"
              }`}
            >
              {selected ? "✓ Added to stack" : "+ Add to stack"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface DockProps {
  selected: Merged[];
  onClear: () => void;
  onOpen: () => void;
}
function StackDock({ selected, onClear, onOpen }: DockProps) {
  if (selected.length === 0) return null;
  const mcpCount = selected.filter((m) => m.ref?.mcp).length;
  const envCount = selected.reduce((acc, m) => acc + (m.ref?.secrets?.length ?? 0), 0);
  return (
    <div className="fixed bottom-0 inset-x-0 z-40" style={{ pointerEvents: "none" }}>
      <div className="mx-auto max-w-[1240px] px-6 sm:px-10 pb-4 sm:pb-6">
        <div
          className="panel-steel flex flex-wrap items-center gap-4 p-3 sm:p-4"
          style={{
            pointerEvents: "auto",
            borderLeft: "3px solid var(--color-blade-500)",
            backdropFilter: "blur(14px)",
            backgroundColor: "rgba(10, 12, 16, 0.82)",
          }}
        >
          <div className="flex items-center gap-3">
            <span className="mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-500)]">your stack</span>
            <span className="mono text-[12px] text-[color:var(--color-ink-100)] tabular-nums">
              {selected.length.toString().padStart(2, "0")} providers
            </span>
            <span className="mono text-[11px] text-[color:var(--color-ink-400)]">
              · {envCount} env vars
            </span>
            {mcpCount > 0 && (
              <span className="mono text-[11px] text-[color:var(--color-blade-400)]">
                · {mcpCount} MCP
              </span>
            )}
          </div>
          <div className="flex -space-x-1">
            {selected.slice(0, 8).map((m) => (
              <div
                key={m.display.name}
                className="w-6 h-6 rounded-full bg-[color:var(--color-ink-800)] border border-[color:var(--color-ink-600)] flex items-center justify-center"
                title={m.display.name}
              >
                {m.iconPath ? (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" className="text-[color:var(--color-ink-200)]">
                    <path d={m.iconPath} />
                  </svg>
                ) : (
                  <span className="mono text-[8px] text-[color:var(--color-ink-300)]">{m.display.name.slice(0, 1)}</span>
                )}
              </div>
            ))}
            {selected.length > 8 && (
              <div className="w-6 h-6 rounded-full bg-[color:var(--color-ink-800)] border border-[color:var(--color-ink-600)] flex items-center justify-center mono text-[9px] text-[color:var(--color-ink-300)]">
                +{selected.length - 8}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              className="mono text-[10px] tracking-[0.14em] uppercase px-2 py-1.5 text-[color:var(--color-ink-400)] hover:text-[color:var(--color-ink-100)]"
            >
              clear
            </button>
            <button
              type="button"
              onClick={onOpen}
              className="mono text-[11px] tracking-[0.14em] uppercase px-4 py-2 bg-[color:var(--color-blade-500)] text-[color:var(--color-ink-950)] border-2 border-[color:var(--color-ink-950)] hover:bg-[color:var(--color-blade-400)]"
              style={{ borderRadius: "3px" }}
            >
              Export recipe →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RecipeProps {
  selected: Merged[];
  onClose: () => void;
}
function RecipeModal({ selected, onClose }: RecipeProps) {
  const batch = buildBatchCommand(selected);
  const env = buildEnvBlock(selected);
  const mcp = buildMcpBlock(selected);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const full = [
    "# Ashlr Stack — recipe export",
    `# ${new Date().toISOString().slice(0, 10)} · ${selected.length} providers`,
    "",
    "# 1. Install Stack",
    "curl -fsSL stack.ashlr.ai/install.sh | bash",
    "",
    "# 2. Initialise the project",
    "stack init",
    "",
    "# 3. Provision every provider in one batch",
    batch,
    "",
    "# Result: .env contents (secret values come from Phantom at read-time)",
    env,
    mcp ? "\n# Result: .mcp.json\n" + mcp : "",
  ].filter(Boolean).join("\n");

  // Intentionally omit `onClose` from deps — listener + body scroll lock
  // should mount/unmount exactly once per modal instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      style={{ backgroundColor: "rgba(5, 7, 10, 0.86)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="panel-steel w-full max-w-[920px] max-h-[90vh] overflow-y-auto p-5 sm:p-7 relative"
        onClick={(e) => e.stopPropagation()}
        style={{ borderLeft: "3px solid var(--color-blade-500)" }}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-500)] mb-1">
              § · recipe export
            </div>
            <h3 className="text-2xl text-[color:var(--color-ink-50)] tracking-tight font-medium">
              {selected.length} providers. One recipe.
            </h3>
            <p className="mt-1 text-sm text-[color:var(--color-ink-300)] max-w-[560px]">
              Every block below is real output from the exact <code className="mono text-[color:var(--color-ink-100)]">stack add</code> invocations Stack would run.
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="mono text-[11px] tracking-[0.12em] uppercase text-[color:var(--color-ink-400)] hover:text-[color:var(--color-ink-100)] focus:outline-none focus:text-[color:var(--color-blade-400)]"
            aria-label="Close recipe export"
          >
            close ✕
          </button>
        </div>

        <div className="space-y-4">
          <div className="panel p-3" style={{ borderLeft: "2px solid var(--color-blade-500)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">batch invocation</span>
              <CopyBtn text={batch} compact />
            </div>
            <div className="mono text-[13px] text-[color:var(--color-ink-100)] break-all">
              <span className="text-[color:var(--color-blade-400)]">›</span> {batch}
            </div>
          </div>

          <div className="panel p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">.env block</span>
              <CopyBtn text={env} compact />
            </div>
            <pre className="mono text-[12px] text-[color:var(--color-ink-200)] leading-[1.5] whitespace-pre-wrap break-all">
              {env}
            </pre>
          </div>

          {mcp && (
            <div className="panel p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">.mcp.json block</span>
                <CopyBtn text={mcp} compact />
              </div>
              <pre className="mono text-[12px] text-[color:var(--color-ink-200)] leading-[1.5] overflow-x-auto">
                {mcp}
              </pre>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <CopyBtn text={full} label="Copy full recipe" />
            <a
              href="/docs/quickstart"
              className="mono text-[11px] tracking-[0.12em] uppercase text-[color:var(--color-ink-300)] hover:text-[color:var(--color-blade-400)]"
            >
              quickstart →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Build guidance string matching the CLI's buildGuidance() in
 * packages/cli/src/commands/recommend.ts — kept in sync so the site fallback
 * renders identical copy when the API round-trip fails.
 */
function buildGuidanceLocal(hits: RetrievalHit[]): string {
  if (hits.length === 0) {
    return "No strong matches. Try describing the concrete capability you need (e.g. 'postgres database', 'stripe subscriptions', 'deploy frontend').";
  }
  const covered = new Set(hits.map((h) => h.provider.category));
  const missing = PROVIDER_CATEGORIES.filter((c) => !covered.has(c));
  const topByCat = Object.entries(
    hits.reduce<Record<string, RetrievalHit>>((acc, h) => {
      if (!acc[h.provider.category] || acc[h.provider.category].score < h.score) {
        acc[h.provider.category] = h;
      }
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1].score - a[1].score)
    .map(([cat, h]) => `${cat} → ${h.provider.name}`);
  const parts: string[] = [`Top pick per category: ${topByCat.join(", ")}.`];
  if (missing.length > 0) {
    parts.push(`No matches for: ${missing.join(", ")}.`);
  }
  return parts.join(" ");
}

/**
 * Call the /api/recommend endpoint, falling back to the client-side retrieve()
 * when the endpoint isn't available (current deploy is static — no server
 * adapter wired yet). `retrieve()` is pure TS over a bundled catalog so the
 * fallback produces identical results without a network round-trip.
 */
async function requestRecommendation(query: string): Promise<RecommendResponse> {
  try {
    const res = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, k: 8 }),
    });
    if (res.ok) {
      return (await res.json()) as RecommendResponse;
    }
  } catch {
    /* fall through to client-side retrieval */
  }
  // Client-side fallback: identical inputs/outputs to the CLI's --json shape.
  const hits = retrieve(query, { k: 8 });
  const byCategory = retrieveByCategory(query, { k: 20 });
  return {
    query,
    hits: hits.map((h) => ({
      name: h.provider.name,
      displayName: h.provider.displayName,
      category: h.provider.category,
      authKind: h.provider.authKind,
      secrets: h.provider.secrets,
      blurb: h.provider.blurb,
      score: Number(h.score.toFixed(3)),
      matched: h.matched,
    })),
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([cat, catHits]) => [
        cat,
        catHits.map((h) => ({
          name: h.provider.name,
          score: Number(h.score.toFixed(3)),
        })),
      ]),
    ),
    guidance: buildGuidanceLocal(hits),
  };
}

interface PromptProps {
  pending: boolean;
  guidance: string | null;
  onSubmit: (query: string) => void;
}
function RecommendPrompt({ pending, guidance, onSubmit }: PromptProps) {
  const [value, setValue] = useState("");

  const submit = () => {
    const q = value.trim();
    if (!q || pending) return;
    onSubmit(q);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="space-y-3">
      <div
        className="panel-steel p-3 sm:p-4"
        style={{ borderLeft: "2px solid var(--color-blade-500)" }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="mono text-[10px] tracking-[0.16em] uppercase text-[color:var(--color-ink-500)]">
            describe your project
          </span>
          <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">
            ↵ to suggest
          </span>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-stretch">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            disabled={pending}
            placeholder="e.g. B2B SaaS with auth, AI, and payments"
            className="flex-1 resize-none bg-[color:var(--color-ink-800)] border border-[color:var(--color-ink-600)] focus:border-[color:var(--color-blade-500)] outline-none mono text-[13px] leading-[1.5] text-[color:var(--color-ink-100)] placeholder:text-[color:var(--color-ink-500)] p-3"
            aria-label="Describe what you're building"
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending || value.trim().length === 0}
            className="mono text-[11px] tracking-[0.14em] uppercase px-5 py-3 bg-[color:var(--color-blade-500)] text-[color:var(--color-ink-950)] border-2 border-[color:var(--color-ink-950)] hover:bg-[color:var(--color-blade-400)] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 whitespace-nowrap"
            style={{ borderRadius: "3px" }}
          >
            {pending ? (
              <span className="inline-flex items-center gap-1" aria-label="Loading">
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-ink-950)]"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: 0 }}
                />
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-ink-950)]"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: 0.15 }}
                />
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-[color:var(--color-ink-950)]"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: 0.3 }}
                />
              </span>
            ) : (
              <>Suggest stack →</>
            )}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {guidance && (
          <motion.div
            key={guidance}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="panel p-3 text-[12px] leading-[1.55] text-[color:var(--color-ink-200)]"
            style={{
              borderLeft: "2px solid #d97706",
              backgroundColor: "rgba(217, 119, 6, 0.06)",
            }}
            role="status"
            aria-live="polite"
          >
            <span className="mono text-[10px] tracking-[0.14em] uppercase text-amber-500 mr-2">
              guidance
            </span>
            {guidance}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface StackBuilderProps { iconPaths: Record<string, string | null> }

export default function StackBuilder({ iconPaths }: StackBuilderProps) {
  const merged = useMemo(() => mergeCatalog(iconPaths), [iconPaths]);
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [recommendPending, setRecommendPending] = useState(false);
  const [guidance, setGuidance] = useState<string | null>(null);

  // Reverse index: ref.name → Merged, so AI hits (which use ref names like
  // "supabase") can be mapped back to the canonical display.name key the
  // selected set uses.
  const byRefName = useMemo(() => {
    const map = new Map<string, Merged>();
    for (const m of merged) {
      if (m.ref?.name) map.set(m.ref.name, m);
      // Also index by display slug variations for stubbed providers.
      map.set(m.display.slug, m);
    }
    return map;
  }, [merged]);

  const handleRecommend = useCallback(
    async (query: string) => {
      setRecommendPending(true);
      try {
        const result = await requestRecommendation(query);
        setGuidance(result.guidance || null);
        if (result.hits.length === 0) {
          // No pre-selection — guidance-only.
          return;
        }
        const displayNames = new Set<string>();
        for (const hit of result.hits) {
          const m = byRefName.get(hit.name);
          if (m) displayNames.add(m.display.name);
        }
        if (displayNames.size > 0) {
          setSelected(displayNames);
        }
      } catch {
        setGuidance(
          "Couldn't reach the recommender. Pick providers from the grid below.",
        );
      } finally {
        setRecommendPending(false);
      }
    },
    [byRefName],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return merged.filter((m) => {
      if (category !== "All" && m.display.category !== category) return false;
      if (!q) return true;
      return (
        m.display.name.toLowerCase().includes(q) ||
        m.display.blurb.toLowerCase().includes(q) ||
        m.display.category.toLowerCase().includes(q) ||
        (m.ref?.secrets ?? []).some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [merged, category, search]);

  const selectedList = useMemo(
    () => merged.filter((m) => selected.has(m.display.name)),
    [merged, selected],
  );

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const expandedMerged = expanded ? merged.find((m) => m.display.name === expanded) ?? null : null;

  const closeRecipe = useCallback(() => setRecipeOpen(false), []);
  const clearSelected = useCallback(() => setSelected(new Set()), []);
  const openRecipe = useCallback(() => setRecipeOpen(true), []);

  return (
    <div className="space-y-8">
      {/* AI recommend prompt — describe the project, auto-select providers */}
      <RecommendPrompt
        pending={recommendPending}
        guidance={guidance}
        onSubmit={handleRecommend}
      />

      {/* Filter bar */}
      <div className="flex flex-col lg:flex-row gap-4 lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2 -ml-1">
          {["All", ...CATEGORIES].map((c) => {
            const active = c === category;
            const count = c === "All" ? merged.length : merged.filter((m) => m.display.category === c).length;
            if (c !== "All" && count === 0) return null;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`mono text-[10px] tracking-[0.14em] uppercase px-3 py-1.5 border transition-colors ${
                  active
                    ? "border-[color:var(--color-blade-500)] text-[color:var(--color-blade-400)] bg-[color:var(--color-blade-500)]/10"
                    : "border-[color:var(--color-ink-600)] text-[color:var(--color-ink-400)] hover:text-[color:var(--color-ink-100)] hover:border-[color:var(--color-steel-500)]"
                }`}
              >
                {c} <span className="ml-1 text-[color:var(--color-ink-500)] tabular-nums">{count.toString().padStart(2, "0")}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 relative w-full lg:w-[280px]">
          <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)] absolute left-3 pointer-events-none">
            ⌕
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search providers or env vars…"
            className="w-full pl-8 pr-3 py-2 bg-[color:var(--color-ink-800)] border border-[color:var(--color-ink-600)] focus:border-[color:var(--color-blade-500)] outline-none mono text-[12px] text-[color:var(--color-ink-100)] placeholder:text-[color:var(--color-ink-500)]"
          />
        </div>
      </div>

      {/* Result count */}
      <div className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">
        showing {filtered.length} / {merged.length} providers
        {selected.size > 0 && <span className="text-[color:var(--color-blade-400)]"> · {selected.size} selected</span>}
      </div>

      {/* Grid */}
      <ul className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((m) => (
          <li key={m.display.name}>
            <ProviderCard
              m={m}
              selected={selected.has(m.display.name)}
              expanded={expanded === m.display.name}
              onToggle={() => toggle(m.display.name)}
              onExpand={() => setExpanded(expanded === m.display.name ? null : m.display.name)}
            />
          </li>
        ))}
      </ul>

      {filtered.length === 0 && (
        <div className="text-center py-16 mono text-[12px] text-[color:var(--color-ink-400)]">
          no providers match "{search}" in {category === "All" ? "any category" : category}
        </div>
      )}

      {/* Inline detail panel */}
      {expandedMerged && (
        <DetailPanel
          m={expandedMerged}
          onClose={() => setExpanded(null)}
          selected={selected.has(expandedMerged.display.name)}
          onToggle={() => toggle(expandedMerged.display.name)}
        />
      )}

      {/* Sticky dock */}
      <StackDock
        selected={selectedList}
        onClear={clearSelected}
        onOpen={openRecipe}
      />

      {/* Recipe modal */}
      {recipeOpen && (
        <RecipeModal selected={selectedList} onClose={closeRecipe} />
      )}
    </div>
  );
}
