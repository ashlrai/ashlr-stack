import { useMemo, useState, useEffect } from "react";
import { PROVIDERS, CATEGORIES, type Provider } from "~/lib/providers";
import { PROVIDERS_REF, type ProviderRef } from "~/lib/providers-ref";

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

async function copy(text: string): Promise<void> {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { /* noop */ }
}

interface CopyBtnProps { text: string; label?: string; compact?: boolean }
function CopyBtn({ text, label = "Copy", compact = false }: CopyBtnProps) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`mono border border-[color:var(--color-steel-500)] hover:border-[color:var(--color-blade-400)] transition-colors ${
        compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-[11px]"
      } tracking-[0.12em] uppercase ${done ? "text-[color:var(--color-blade-400)]" : "text-[color:var(--color-ink-300)]"}`}
      onClick={async () => {
        await copy(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

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
            type="button"
            onClick={onClose}
            className="mono text-[11px] tracking-[0.12em] uppercase text-[color:var(--color-ink-400)] hover:text-[color:var(--color-ink-100)]"
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

interface StackBuilderProps { iconPaths: Record<string, string | null> }

export default function StackBuilder({ iconPaths }: StackBuilderProps) {
  const merged = useMemo(() => mergeCatalog(iconPaths), [iconPaths]);
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [recipeOpen, setRecipeOpen] = useState(false);

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

  return (
    <div className="space-y-8">
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
        onClear={() => setSelected(new Set())}
        onOpen={() => setRecipeOpen(true)}
      />

      {/* Recipe modal */}
      {recipeOpen && (
        <RecipeModal selected={selectedList} onClose={() => setRecipeOpen(false)} />
      )}
    </div>
  );
}
