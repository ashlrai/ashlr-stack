import { useMemo, useState } from "react";
import { PROVIDERS_REF, type ProviderRef } from "~/lib/providers-ref";

/**
 * TemplateExplorer — click a template card to see the real recipe it
 * produces: the sequence of `stack add` commands, the env block each
 * provider writes, and the consolidated .mcp.json entry the agent gets.
 *
 * Every command + config snippet below is derived from the same source
 * (PROVIDERS_REF) that the CLI itself uses, so if a provider's secrets
 * change upstream the template preview updates automatically.
 */

export interface Template {
  id: string;
  title: string;
  blurb: string;
  /** Lower-case provider ref names (must match PROVIDERS_REF[].name). */
  refNames: string[];
  /** Brand-color hex (no #) for accent. */
  accent?: string;
  /** Array of per-provider icon SVG paths, pre-resolved Astro-side. */
  iconPaths: (string | null)[];
  /** Display names matching iconPaths order. */
  iconNames: string[];
  /** Brand colors matching iconPaths order (no #). */
  iconColors: string[];
}

interface Props { templates: Template[] }

function formatAuthKind(kind: ProviderRef["authKind"]): string {
  switch (kind) {
    case "oauth_pkce": return "OAuth (PKCE)";
    case "oauth_device": return "OAuth (device)";
    case "pat": return "Personal access token";
    case "api_key": return "API key";
  }
}

function buildRecipe(refs: ProviderRef[]): {
  cmd: string;
  env: string;
  mcp: string;
  totalSecrets: number;
  mcpCount: number;
} {
  const cmd = `stack add ${refs.map((r) => r.name).join(" ")}`;
  const env = refs
    .map((r) => [
      `# ${r.displayName} — ${formatAuthKind(r.authKind)}`,
      ...r.secrets.map((s) => `${s}=<phantom://${r.name}/${s}>`),
    ].join("\n"))
    .join("\n\n");

  const mcpRefs = refs.filter((r) => r.mcp);
  const servers: Record<string, unknown> = {};
  for (const r of mcpRefs) {
    if (!r.mcp) continue;
    servers[r.mcp.name] = {
      command: "stack",
      args: ["mcp", "run", r.mcp.name],
      env: Object.fromEntries(r.secrets.map((s) => [s, `<phantom://${r.name}/${s}>`])),
    };
  }
  const mcp = mcpRefs.length ? JSON.stringify({ mcpServers: servers }, null, 2) : "";

  return {
    cmd,
    env,
    mcp,
    totalSecrets: refs.reduce((n, r) => n + r.secrets.length, 0),
    mcpCount: mcpRefs.length,
  };
}

async function copyText(text: string) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch { /* noop */ }
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className={`mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 border transition-colors ${
        done
          ? "border-[color:var(--color-blade-400)] text-[color:var(--color-blade-400)]"
          : "border-[color:var(--color-steel-500)] text-[color:var(--color-ink-300)] hover:border-[color:var(--color-blade-400)] hover:text-[color:var(--color-blade-400)]"
      }`}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export default function TemplateExplorer({ templates }: Props) {
  const [activeId, setActiveId] = useState<string>(templates[0]?.id ?? "");
  const refByName = useMemo(
    () => new Map(PROVIDERS_REF.map((r) => [r.name, r])),
    [],
  );

  const active = templates.find((t) => t.id === activeId) ?? templates[0];
  const refs = active
    ? active.refNames.map((n) => refByName.get(n)).filter(Boolean) as ProviderRef[]
    : [];
  const recipe = buildRecipe(refs);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
      {/* Template list (left) */}
      <ul className="space-y-2">
        {templates.map((t) => {
          const isActive = t.id === active?.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setActiveId(t.id)}
                className={`w-full text-left panel p-4 transition-all ${
                  isActive
                    ? "ring-1 ring-[color:var(--color-blade-500)]"
                    : "opacity-80 hover:opacity-100"
                }`}
                style={{
                  borderLeft: isActive ? "2px solid var(--color-blade-500)" : "2px solid transparent",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  {t.iconPaths.map((path, i) => (
                    <span
                      key={t.iconNames[i]}
                      className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center"
                      title={t.iconNames[i]}
                      style={{ ["--brand" as string]: `#${t.iconColors[i]}` }}
                    >
                      {path ? (
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" className="text-[color:var(--color-ink-200)]">
                          <path d={path} />
                        </svg>
                      ) : (
                        <span className="mono text-[8px] text-[color:var(--color-ink-400)]">
                          {t.iconNames[i].slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                <h3 className={`text-sm font-medium tracking-tight ${isActive ? "text-[color:var(--color-ink-50)]" : "text-[color:var(--color-ink-100)]"}`}>
                  {t.title}
                </h3>
                <p className="mt-1 text-[11px] text-[color:var(--color-ink-400)] leading-[1.5]">
                  {t.blurb}
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Recipe panel (right) */}
      <div className="panel-steel p-5 sm:p-6" style={{ borderLeft: "3px solid var(--color-blade-500)" }}>
        {!active ? (
          <div className="mono text-[12px] text-[color:var(--color-ink-400)]">select a template</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className="mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-500)] mb-1">
                  § · {active.id}
                </div>
                <h4 className="text-xl text-[color:var(--color-ink-50)] tracking-tight font-medium">
                  {active.title}
                </h4>
                <p className="mt-1 text-sm text-[color:var(--color-ink-300)] max-w-[560px]">
                  {active.blurb}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-ink-500)]">
                <span><span className="text-[color:var(--color-ink-100)] tabular-nums">{refs.length}</span> providers</span>
                <span><span className="text-[color:var(--color-ink-100)] tabular-nums">{recipe.totalSecrets}</span> env vars</span>
                {recipe.mcpCount > 0 && (
                  <span className="text-[color:var(--color-blade-400)]">
                    <span className="tabular-nums">{recipe.mcpCount}</span> MCP servers
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {/* Init command */}
              <div className="panel p-3" style={{ borderLeft: "2px solid var(--color-blade-500)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">template init</span>
                  <CopyBtn text={`stack init --template ${active.id}`} />
                </div>
                <div className="mono text-[13px] text-[color:var(--color-ink-100)] break-all">
                  <span className="text-[color:var(--color-blade-400)]">›</span> stack init --template {active.id}
                </div>
              </div>

              {/* Equivalent batch add */}
              <div className="panel p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">which runs</span>
                  <CopyBtn text={recipe.cmd} />
                </div>
                <div className="mono text-[13px] text-[color:var(--color-ink-100)] break-all">
                  <span className="text-[color:var(--color-blade-400)]">›</span> {recipe.cmd}
                </div>
              </div>

              {/* Env block */}
              <div className="panel p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">.env written</span>
                  <CopyBtn text={recipe.env} />
                </div>
                <pre className="mono text-[12px] text-[color:var(--color-ink-200)] leading-[1.5] whitespace-pre-wrap break-all max-h-[280px] overflow-y-auto">
                  {recipe.env}
                </pre>
              </div>

              {/* MCP block */}
              {recipe.mcp && (
                <div className="panel p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">.mcp.json written</span>
                    <CopyBtn text={recipe.mcp} />
                  </div>
                  <pre className="mono text-[12px] text-[color:var(--color-ink-200)] leading-[1.5] overflow-x-auto max-h-[280px] overflow-y-auto">
                    {recipe.mcp}
                  </pre>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
