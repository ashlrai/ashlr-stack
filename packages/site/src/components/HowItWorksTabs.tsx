import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "~/lib/use-prefers-reduced-motion";
import { linkifyPhantom } from "~/lib/phantom-link";

/**
 * HowItWorksTabs — interactive three-step explainer.
 *
 * One tab per surface Stack coordinates (CLI / Vault / Files). Clicking
 * a tab reveals a realistic terminal capture + a short note on what
 * that surface guarantees. Auto-advances every ~6s until the user
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
    blurb: "You run stack add. The CLI drives provider OAuth, creates the upstream resource, and picks sane defaults — region, plan, project name — inferred from your repo.",
    guarantee: "Every upstream change is idempotent + reversible. Re-running stack add is safe.",
    lines: [
      { kind: "prompt", text: "stack add supabase" },
      { kind: "out", text: "▲ stack  adding Supabase" },
      { kind: "dim", text: "  auth · OAuth (PKCE) via the Ashlr Stack app" },
      { kind: "work", text: "OAuth browser flow", detail: "signed in as mason@evero-consulting.com" },
      { kind: "work", text: "provisioning project raven-prod · us-east-1", detail: "db.abc123def.supabase.co" },
      { kind: "work", text: "fetching SUPABASE_URL · ANON_KEY · SERVICE_ROLE_KEY" },
      { kind: "ok", text: "✓ supabase ready · 4.2s" },
    ],
  },
  {
    id: "vault",
    n: "02",
    title: "Phantom stores",
    blurb: "Every secret is written through Phantom. Stack never holds the values — it holds the slot names and lets Phantom's E2E-encrypted vault do the key-material work.",
    guarantee: "Secrets never touch disk in plaintext. Stack code paths only ever reference phantom:// slots.",
    lines: [
      { kind: "prompt", text: "phantom status" },
      { kind: "out", text: "phantom  v0.4.1" },
      { kind: "dim", text: "  vault: ~/.phantom  ·  E2E encrypted · unlocked" },
      { kind: "work", text: "  SUPABASE_URL                    stored · rotated 0 times" },
      { kind: "work", text: "  SUPABASE_ANON_KEY               stored · rotated 0 times" },
      { kind: "work", text: "  SUPABASE_SERVICE_ROLE_KEY       stored · rotated 0 times" },
      { kind: "ok", text: "✓ 3 slots managed by phantom" },
    ],
  },
  {
    id: "files",
    n: "03",
    title: "Files wired everywhere",
    blurb: "Stack patches .env.local, .mcp.json, and .stack.toml. Your dev server, editor, and Claude Code all read the same slot names — values are resolved at read-time via Phantom.",
    guarantee: "One source of truth. Revoking a key in Phantom instantly invalidates it across every consumer.",
    lines: [
      { kind: "prompt", text: "cat .env.local" },
      { kind: "out", text: "# Ashlr Stack — managed block (do not edit)" },
      { kind: "out", text: "SUPABASE_URL=<phantom://supabase/SUPABASE_URL>" },
      { kind: "out", text: "SUPABASE_ANON_KEY=<phantom://supabase/SUPABASE_ANON_KEY>" },
      { kind: "out", text: "SUPABASE_SERVICE_ROLE_KEY=<phantom://supabase/SUPABASE_SERVICE_ROLE_KEY>" },
      { kind: "dim", text: "# end managed block" },
      { kind: "prompt", text: "stack exec -- bun dev" },
      { kind: "ok", text: "✓ 3 tokens resolved · starting Next.js 15 on http://localhost:3000" },
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
              onClick={() => { setActive(i); setAuto(false); }}
              className={`shrink-0 lg:shrink text-left panel p-4 transition-all min-w-[220px] lg:min-w-0 ${
                isActive ? "ring-1 ring-[color:var(--color-blade-500)]" : "opacity-80 hover:opacity-100"
              }`}
              style={{ borderLeft: isActive ? "2px solid var(--color-blade-500)" : "2px solid transparent" }}
              aria-selected={isActive}
              role="tab"
            >
              <div className="flex items-center gap-3 mb-2">
                <span
                  className={`mono text-[11px] tabular-nums ${
                    isActive ? "text-[color:var(--color-blade-400)]" : "text-[color:var(--color-ink-400)]"
                  }`}
                >
                  {t.n}
                </span>
                <span
                  className={`text-sm font-medium tracking-tight ${
                    isActive ? "text-[color:var(--color-ink-50)]" : "text-[color:var(--color-ink-200)]"
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
            <span className="w-1.5 h-1.5 bg-[color:var(--color-blade-500)]" style={{ animation: "pulse 1600ms ease-in-out infinite" }} />
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
              STK · {current.n} · {current.title}
            </span>
          </div>
          <span className="mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-500)]">
            {active + 1} / {TABS.length}
          </span>
        </div>

        <div className="mono text-[12.5px] leading-[1.75] p-4 sm:p-5 min-h-[280px]">
          {current.lines.map((l, i) => (
            <div key={i} className="flex items-start gap-2">
              {l.kind === "prompt" && <span className="text-[color:var(--color-blade-400)] select-none">›</span>}
              {l.kind === "work" && <span className="text-[color:var(--color-signal-ok,#6fe8a7)] select-none">✓</span>}
              {(l.kind === "out" || l.kind === "dim" || l.kind === "ok") && <span className="select-none" style={{ opacity: 0 }}>·</span>}
              <div className="flex-1 min-w-0 break-words">
                <span
                  className={
                    l.kind === "prompt"   ? "text-[color:var(--color-ink-50)]"
                    : l.kind === "ok"     ? "text-[color:var(--color-signal-ok,#6fe8a7)]"
                    : l.kind === "dim"    ? "text-[color:var(--color-ink-400)]"
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
            guarantee
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
