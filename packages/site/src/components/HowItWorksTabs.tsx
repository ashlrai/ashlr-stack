import { useEffect, useState } from "react";
import { linkifyPhantom } from "~/lib/phantom-link";
import { usePrefersReducedMotion } from "~/lib/use-prefers-reduced-motion";

/**
 * HowItWorksTabs — interactive three-step explainer.
 *
 * One tab per surface Stack coordinates (CLI / Vault / Files). Clicking
 * a tab reveals an illustrative terminal example + a short note on what
 * to inspect. Auto-advances every ~6s until the user
 * clicks a tab manually, then stops.
 */

interface TerminalLine {
  kind: "prompt" | "out" | "work" | "ok" | "dim";
  text: string;
  detail?: string;
}

interface Tab {
  id: string;
  n: string;
  title: string;
  blurb: string;
  guarantee: string;
  lines: TerminalLine[];
}

const TABS: Tab[] = [
  {
    id: "cli",
    n: "01",
    title: "CLI orchestrates",
    blurb:
      "Run stack add for a supported provider. Account approval, resource creation or attachment, and available defaults depend on that adapter and your access.",
    guarantee:
      "Inspect each result. A failed setup can leave upstream or vault state that needs manual cleanup.",
    lines: [
      { kind: "prompt", text: "stack add supabase" },
      { kind: "out", text: "▲ stack  adding Supabase" },
      { kind: "dim", text: "  auth · OAuth (PKCE) via the Ashlr Stack app" },
      {
        kind: "work",
        text: "browser approval, if requested",
        detail: "example account only",
      },
      {
        kind: "work",
        text: "creating or attaching an example project",
        detail: "actual resource depends on your account",
      },
      { kind: "work", text: "fetching SUPABASE_URL · ANON_KEY · SERVICE_ROLE_KEY" },
      { kind: "ok", text: "Review setup result before using the service" },
    ],
  },
  {
    id: "vault",
    n: "02",
    title: "Phantom stores",
    blurb:
      "After a successful add, Stack passes returned credentials to Phantom and records the slot names in local configuration. Inspect the result for this provider.",
    guarantee:
      "Credential values pass through setup in memory. Review Phantom storage and any files your own app writes.",
    lines: [
      { kind: "prompt", text: "stack info supabase" },
      { kind: "out", text: "example service record · no secret values shown" },
      { kind: "dim", text: "  Phantom holds returned credentials if setup succeeded" },
      { kind: "work", text: "  SUPABASE_URL                    declared slot" },
      { kind: "work", text: "  SUPABASE_ANON_KEY               declared slot" },
      { kind: "work", text: "  SUPABASE_SERVICE_ROLE_KEY       declared slot" },
      { kind: "ok", text: "Verify stored slots separately in your vault" },
    ],
  },
  {
    id: "files",
    n: "03",
    title: "Review local files",
    blurb:
      "Stack records successful services in .stack.toml and merges a provider MCP entry when one is supplied. Generate an optional empty-key .env.example; wire your app separately.",
    guarantee:
      "Inspect .stack.toml and any MCP entry. Check each app consumer after changing or revoking a credential.",
    lines: [
      { kind: "prompt", text: "stack env export --example --stdout" },
      { kind: "out", text: "# Optional .env.example skeleton; values remain empty" },
      { kind: "out", text: "SUPABASE_URL=" },
      { kind: "out", text: "SUPABASE_ANON_KEY=" },
      {
        kind: "out",
        text: "SUPABASE_SERVICE_ROLE_KEY=",
      },
      { kind: "dim", text: "# no credentials exported" },
      { kind: "prompt", text: "stack exec -- bun dev" },
      {
        kind: "ok",
        text: "stack exec forwards to Phantom; verify your app receives its required values",
      },
    ],
  },
];

const AUTO_ADVANCE_MS = 6000;

export default function HowItWorksTabs() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(!reduced);

  useEffect(() => {
    if (!auto || reduced) return;
    const id = setInterval(() => {
      setActive((a) => (a + 1) % TABS.length);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [auto, reduced]);

  const current = TABS[active] ?? TABS[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      {/* Tab list */}
      <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible -mx-1 px-1">
        {TABS.map((t, i) => {
          const isActive = i === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setActive(i);
                setAuto(false);
              }}
              className={`w-[220px] lg:w-auto shrink-0 lg:shrink text-left panel p-4 transition-all min-w-[220px] lg:min-w-0 ${
                isActive
                  ? "ring-1 ring-[color:var(--color-blade-500)]"
                  : "opacity-80 hover:opacity-100"
              }`}
              style={{
                borderLeft: isActive ? "2px solid var(--color-blade-500)" : "2px solid transparent",
              }}
              aria-selected={isActive}
              role="tab"
            >
              <div className="flex items-center gap-3 mb-2">
                <span
                  className={`mono text-[11px] tabular-nums ${
                    isActive
                      ? "text-[color:var(--color-blade-400)]"
                      : "text-[color:var(--color-ink-400)]"
                  }`}
                >
                  {t.n}
                </span>
                <span
                  className={`text-sm font-medium tracking-tight ${
                    isActive
                      ? "text-[color:var(--color-ink-50)]"
                      : "text-[color:var(--color-ink-200)]"
                  }`}
                >
                  {t.title}
                </span>
              </div>
              <p className="text-[11px] text-[color:var(--color-ink-400)] leading-[1.5]">
                {linkifyPhantom(t.blurb)}
              </p>
            </button>
          );
        })}
        {auto && (
          <div className="hidden lg:flex items-center gap-2 mt-2 mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-500)]">
            <span
              className="w-1.5 h-1.5 bg-[color:var(--color-blade-500)]"
              style={{ animation: "pulse 1600ms ease-in-out infinite" }}
            />
            auto-advancing · click a tab to pause
          </div>
        )}
      </div>

      {/* Terminal pane */}
      <div
        key={current.id}
        className="tick-corners panel-steel relative"
        style={{ borderLeft: "2px solid var(--color-blade-500)", animation: "howFade 320ms ease" }}
      >
        <span className="tick-tr" />
        <span className="tick-bl" />

        <div
          className="flex items-center justify-between px-4 py-2 border-b border-[color:var(--color-ink-600)]"
          style={{ backgroundColor: "rgba(10, 12, 16, 0.6)" }}
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[color:var(--color-steel-500)]" />
            <span className="w-2 h-2 rounded-full bg-[color:var(--color-steel-500)]" />
            <span className="w-2 h-2 rounded-full bg-[color:var(--color-blade-500)]" />
            <span className="ml-3 mono text-[11px] tracking-[0.14em] uppercase text-[color:var(--color-ink-400)]">
              ILLUSTRATIVE · {current.n} · {current.title}
            </span>
          </div>
          <span className="mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-500)]">
            {active + 1} / {TABS.length}
          </span>
        </div>

        <div className="mono text-[12.5px] leading-[1.75] p-4 sm:p-5 min-h-[280px]">
          {current.lines.map((l) => (
            <div key={`${l.kind}-${l.text}`} className="flex items-start gap-2">
              {l.kind === "prompt" && (
                <span className="text-[color:var(--color-blade-400)] select-none">›</span>
              )}
              {l.kind === "work" && (
                <span className="text-[color:var(--color-signal-ok,#6fe8a7)] select-none">✓</span>
              )}
              {(l.kind === "out" || l.kind === "dim" || l.kind === "ok") && (
                <span className="select-none" style={{ opacity: 0 }}>
                  ·
                </span>
              )}
              <div className="flex-1 min-w-0 break-words">
                <span
                  className={
                    l.kind === "prompt"
                      ? "text-[color:var(--color-ink-50)]"
                      : l.kind === "ok"
                        ? "text-[color:var(--color-signal-ok,#6fe8a7)]"
                        : l.kind === "dim"
                          ? "text-[color:var(--color-ink-400)]"
                          : "text-[color:var(--color-ink-100)]"
                  }
                >
                  {l.text}
                </span>
                {l.detail && (
                  <span className="ml-2 text-[color:var(--color-ink-500)] text-[11px]">
                    {l.detail}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          className="px-4 sm:px-5 py-3 border-t border-[color:var(--color-ink-600)] flex items-center gap-2"
          style={{ backgroundColor: "rgba(10, 12, 16, 0.4)" }}
        >
          <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-blade-400)] shrink-0">
            to verify
          </span>
          <span className="text-[12px] text-[color:var(--color-ink-200)] leading-[1.5]">
            {linkifyPhantom(current.guarantee)}
          </span>
        </div>
      </div>

      <style>{`
        @keyframes howFade {
          from { opacity: 0.3; transform: translateY(4px); }
          to   { opacity: 1;   transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
