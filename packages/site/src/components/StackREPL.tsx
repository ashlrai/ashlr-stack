import { useEffect, useMemo, useRef, useState } from "react";
import { PROVIDERS_REF, type ProviderRef } from "~/lib/providers-ref";
import { usePrefersReducedMotion } from "~/lib/use-prefers-reduced-motion";
import { retrieve } from "../../../core/src/ai/catalog-index";

/**
 * StackREPL — an in-browser pseudo-terminal that speaks `stack` commands.
 *
 * Short scripted intro (`stack init` → `stack providers`) to show the shape, then
 * unlocks and accepts typed input. Commands are parsed client-side and
 * matched against PROVIDERS_REF so every provider-specific output reflects
 * the catalog slot names and MCP hints. All output is simulated, not actual CLI/provider results.
 *
 * Supported:
 *   stack --help                     — list commands
 *   stack init                     — fake init
 *   stack providers                — show catalog entries
 *   stack add <name>              — simulate one provider plan
 *   stack doctor                   — fake health check
 *   stack open <name>              — dashboard URL for <name>
 *   clear                          — clear screen
 */

type LineKind = "prompt" | "out" | "err" | "ok" | "dim" | "work";
interface Line {
  id: number;
  kind: LineKind;
  text: string;
  detail?: string;
}

const INTRO_DELAY = 500;
const LINE_DELAY = 60;

function genId(): number {
  return Math.floor(Math.random() * 1e9);
}

const HELP_SOURCE: { kind: LineKind; text: string }[] = [
  { kind: "out", text: "▲ simulated Stack command examples" },
  { kind: "dim", text: "  stack init                       initialise the current directory" },
  { kind: "dim", text: "  stack providers                   list the provider catalog" },
  {
    kind: "dim",
    text: "  stack add <name>                 plan one provider setup",
  },
  {
    kind: "dim",
    text: '  stack recommend "<query>"         retrieve curated provider matches',
  },
  { kind: "dim", text: "  stack doctor                      show an illustrative check report" },
  { kind: "dim", text: "  stack open <name>                 open a provider dashboard" },
  { kind: "dim", text: "  clear                             clear the screen" },
];

function mkLine(kind: LineKind, text: string, detail?: string): Line {
  return { id: genId(), kind, text, detail };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Simulate a provider add — 3–5 realistic steps. */
async function simulateAdd(
  ref: ProviderRef,
  push: (l: Line) => void,
  reduced: boolean,
): Promise<void> {
  const authLabel =
    ref.authKind === "oauth_pkce"
      ? "catalog OAuth (PKCE) requirement"
      : ref.authKind === "oauth_device"
        ? "OAuth device-code flow"
        : ref.authKind === "pat"
          ? "Personal access token"
          : "API key";

  push(mkLine("out", `▲ stack  adding ${ref.displayName}`));
  await sleep(reduced ? 0 : 120);
  push(mkLine("dim", `  auth · ${authLabel}`));
  await sleep(reduced ? 0 : 200);
  push(
    mkLine(
      "work",
      `  ${ref.authKind === "oauth_pkce" ? "OAuth browser flow" : "credential check"}`,
      "not executed",
    ),
  );
  await sleep(reduced ? 0 : 400);
  push(
    mkLine(
      "work",
      `  plan provider-specific setup for ${ref.displayName}`,
      ref.notes?.includes("stores")
        ? "catalog note only; no request sent"
        : "resource behavior depends on the provider",
    ),
  );
  await sleep(reduced ? 0 : 600);
  push(
    mkLine(
      "work",
      `  catalog: ${ref.secrets.length} secret slot${ref.secrets.length === 1 ? "" : "s"}; no values stored`,
      ref.secrets.join(" · "),
    ),
  );
  await sleep(reduced ? 0 : 300);
  push(
    mkLine(
      "work",
      `  review .stack.toml${ref.mcp ? " and provider MCP configuration" : ""}; no files written`,
    ),
  );
  await sleep(reduced ? 0 : 280);
  if (ref.mcp) {
    push(
      mkLine(
        "work",
        `  catalog MCP hint "${ref.mcp.name}"; configure separately`,
        ref.mcp.detail.slice(0, 84) + (ref.mcp.detail.length > 84 ? "…" : ""),
      ),
    );
    await sleep(reduced ? 0 : 260);
  }
  push(mkLine("ok", `Preview complete: ${ref.displayName}; setup and acceptance remain separate`));
}

function findRef(name: string): ProviderRef | null {
  const n = name.toLowerCase();
  return PROVIDERS_REF.find((r) => r.name === n || r.displayName.toLowerCase() === n) ?? null;
}

export default function StackREPL() {
  const reduced = usePrefersReducedMotion();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [busy, setBusy] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const providerNames = useMemo(() => PROVIDERS_REF.map((r) => r.name), []);

  const push = (l: Line) => setLines((prev) => [...prev, l]);
  const pushMany = (ls: Line[]) => setLines((prev) => [...prev, ...ls]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines]);

  // Scripted intro: stack init → stack providers
  useEffect(() => {
    let cancelled = false;

    (async () => {
      await sleep(reduced ? 0 : INTRO_DELAY);
      if (cancelled) return;

      push(mkLine("prompt", "stack init"));
      await sleep(reduced ? 0 : 400);
      push(mkLine("out", "▲ simulated init · no project files written"));
      await sleep(reduced ? 0 : LINE_DELAY);
      push(
        mkLine(
          "work",
          "expected shape: .stack.toml · .stack.local.toml",
          "inspect ignore rules after real setup",
        ),
      );
      await sleep(reduced ? 0 : 500);
      push(mkLine("work", "project registry is local; no registration runs in this demo"));
      await sleep(reduced ? 0 : 300);
      push(mkLine("ok", "Preview only · real next step: stack add <provider>"));
      await sleep(reduced ? 0 : 700);

      if (cancelled) return;

      push(mkLine("prompt", "stack providers"));
      await sleep(reduced ? 0 : 300);
      push(mkLine("out", `▲ stack  ${PROVIDERS_REF.length} providers available`));

      const byCat = new Map<string, ProviderRef[]>();
      for (const r of PROVIDERS_REF) {
        (byCat.get(r.category) ?? byCat.set(r.category, []).get(r.category)!).push(r);
      }

      for (const [cat, refs] of byCat) {
        if (cancelled) return;
        pushMany([
          mkLine("dim", `  ${cat.toUpperCase()}`),
          ...refs.map((r) =>
            mkLine(
              "out",
              `    ${r.name.padEnd(14)} ${r.blurb.slice(0, 44)}${r.blurb.length > 44 ? "…" : ""}`,
            ),
          ),
        ]);
        await sleep(reduced ? 0 : 120);
      }

      if (cancelled) return;
      await sleep(reduced ? 0 : 400);
      push(mkLine("ok", "✓ try: stack add <name> — or type 'stack --help'"));
      setBusy(false);
      setUnlocked(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [reduced]);

  const runCommand = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;

    setHistory((h) => [cmd, ...h].slice(0, 30));
    setHistoryIdx(-1);
    push(mkLine("prompt", cmd));

    if (cmd === "clear") {
      setLines([]);
      return;
    }

    const parts = cmd.split(/\s+/);
    if (parts[0] !== "stack") {
      push(mkLine("err", `command not found: ${parts[0]} — try 'stack --help'`));
      return;
    }

    setBusy(true);
    try {
      const sub = parts[1];
      if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
        pushMany(HELP_SOURCE.map((l) => mkLine(l.kind, l.text)));
        return;
      }

      if (sub === "init") {
        push(mkLine("dim", "(already initialised in this session — nothing to do)"));
        return;
      }

      if (sub === "providers") {
        push(mkLine("out", `▲ stack  ${PROVIDERS_REF.length} providers`));
        for (const r of PROVIDERS_REF) {
          push(
            mkLine(
              "out",
              `  ${r.name.padEnd(14)} ${r.blurb.slice(0, 60)}${r.blurb.length > 60 ? "…" : ""}`,
            ),
          );
        }
        return;
      }

      if (sub === "doctor") {
        push(mkLine("out", "▲ stack doctor"));
        await sleep(reduced ? 0 : 200);
        push(mkLine("work", "runtime         ", "use the installed package requirements"));
        await sleep(reduced ? 0 : 140);
        push(
          mkLine("work", "Phantom         ", "secret operations need a compatible installation"),
        );
        await sleep(reduced ? 0 : 140);
        push(mkLine("work", "MCP client      ", "configure separately; no client detected here"));
        await sleep(reduced ? 0 : 140);
        push(
          mkLine("work", "healthchecks    ", "provider-specific results; no network calls here"),
        );
        await sleep(reduced ? 0 : 140);
        push(mkLine("ok", "Simulated report only · run real checks and inspect their results"));
        return;
      }

      if (sub === "open") {
        const ref = parts[2] ? findRef(parts[2]) : null;
        if (!ref) {
          push(mkLine("err", `unknown provider: ${parts[2] ?? "(none)"} — try stack providers`));
          return;
        }
        push(mkLine("out", `Dashboard reference only: ${ref.dashboard || "(no dashboard URL)"}`));
        return;
      }

      if (sub === "add") {
        const names = parts.slice(2);
        if (names.length !== 1) {
          push(
            mkLine(
              "err",
              "usage: stack add <name> — run one command per service (e.g. stack add supabase)",
            ),
          );
          return;
        }
        for (const name of names) {
          const ref = findRef(name);
          if (!ref) {
            push(mkLine("err", `unknown provider: ${name} — try stack providers`));
            continue;
          }
          await simulateAdd(ref, push, reduced);
        }
        return;
      }

      if (sub === "recommend") {
        // Re-parse the original command so quoted queries survive tokenisation.
        // Example: `stack recommend "b2b saas with auth"` → query = "b2b saas with auth".
        const afterSub = cmd.slice(cmd.indexOf("recommend") + "recommend".length).trim();
        const query = afterSub.replace(/^["']|["']$/g, "").trim();
        if (!query) {
          push(mkLine("out", "▲ stack recommend"));
          push(mkLine("dim", '  Usage: stack recommend "B2B SaaS with auth, AI, and payments"'));
          push(mkLine("dim", "  No query — nothing to recommend."));
          return;
        }
        push(mkLine("out", "▲ stack recommend"));
        push(mkLine("dim", `  query: ${query}`));
        await sleep(reduced ? 0 : 200);
        const hits = retrieve(query, { k: 6 });
        if (hits.length === 0) {
          push(mkLine("err", "  No strong matches."));
          push(
            mkLine(
              "dim",
              "  Try describing the concrete capability you need (e.g. 'postgres database', 'stripe subscriptions', 'deploy frontend').",
            ),
          );
          return;
        }
        for (const hit of hits) {
          push(
            mkLine(
              "out",
              `  ● ${hit.provider.displayName.padEnd(14)} ${hit.provider.category.padEnd(10)} (${hit.score.toFixed(2)})  ${hit.provider.blurb.slice(0, 52)}${hit.provider.blurb.length > 52 ? "…" : ""}`,
            ),
          );
          push(mkLine("dim", `      add with: stack add ${hit.provider.name}`));
        }
        const topNames = hits
          .slice(0, 3)
          .map((h) => `stack add ${h.provider.name}`)
          .join(" && ");
        push(mkLine("ok", `Try separate commands: ${topNames}`));
        return;
      }

      push(mkLine("err", `unknown subcommand: ${sub} — try 'stack --help'`));
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = input;
      setInput("");
      void runCommand(v);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(history.length - 1, historyIdx + 1);
      setHistoryIdx(next);
      setInput(history[next] ?? "");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(-1, historyIdx - 1);
      setHistoryIdx(next);
      setInput(next === -1 ? "" : (history[next] ?? ""));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      // simple completion on provider names after "stack add "
      const m = input.match(/^(stack\s+add\s+.*?)([a-zA-Z0-9]*)$/);
      if (m) {
        const [, head, frag] = m;
        const matches = providerNames.filter((n) => n.startsWith(frag.toLowerCase()));
        if (matches.length === 1) setInput(`${head + matches[0]} `);
      }
    }
  };

  const suggestions = [
    'stack recommend "b2b saas with auth and payments"',
    "stack add supabase",
    "stack doctor",
    "stack providers",
    "stack --help",
  ];

  return (
    <div
      className="tick-corners panel-steel relative"
      style={{ borderLeft: "2px solid var(--color-blade-500)" }}
    >
      <span className="tick-tr" />
      <span className="tick-bl" />

      {/* Titlebar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b border-[color:var(--color-ink-600)]"
        style={{ backgroundColor: "rgba(10, 12, 16, 0.6)" }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[color:var(--color-steel-500)]" />
          <span className="w-2 h-2 rounded-full bg-[color:var(--color-steel-500)]" />
          <span className="w-2 h-2 rounded-full bg-[color:var(--color-blade-500)]" />
          <span className="ml-3 mono text-[11px] tracking-[0.14em] uppercase text-[color:var(--color-ink-400)]">
            STK-01 · SIMULATED · no provider or file effects
          </span>
        </div>
        <button
          type="button"
          onClick={() => setLines([])}
          disabled={busy}
          className="mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-500)] hover:text-[color:var(--color-ink-100)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[color:var(--color-ink-500)]"
        >
          clear
        </button>
      </div>

      {/* Body */}
      <div
        ref={bodyRef}
        className="mono text-[12.5px] leading-[1.75] px-4 sm:px-5 py-4 h-[460px] sm:h-[520px] overflow-y-auto"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((l) => (
          <div key={l.id} className="flex items-start gap-2">
            {l.kind === "prompt" && (
              <span className="text-[color:var(--color-blade-400)] select-none">›</span>
            )}
            {l.kind === "work" && (
              <span className="text-[color:var(--color-signal-ok,#6fe8a7)] select-none">✓</span>
            )}
            {l.kind === "ok" && (
              <span className="select-none" style={{ opacity: 0 }}>
                ·
              </span>
            )}
            {l.kind === "err" && (
              <span className="text-[color:var(--color-signal-err,#f56868)] select-none">✕</span>
            )}
            {(l.kind === "out" || l.kind === "dim") && (
              <span className="select-none" style={{ opacity: 0 }}>
                ·
              </span>
            )}
            <div className="flex-1 min-w-0 break-words">
              <span
                className={
                  l.kind === "prompt"
                    ? "text-[color:var(--color-ink-50)]"
                    : l.kind === "err"
                      ? "text-[color:var(--color-signal-err,#f56868)]"
                      : l.kind === "ok"
                        ? "text-[color:var(--color-signal-ok,#6fe8a7)]"
                        : l.kind === "dim"
                          ? "text-[color:var(--color-ink-400)]"
                          : l.kind === "work"
                            ? "text-[color:var(--color-ink-100)]"
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

        {/* Input row */}
        {unlocked && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[color:var(--color-blade-400)] select-none">›</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              placeholder={busy ? "" : "type a command (try: stack add supabase)"}
              className="flex-1 bg-transparent outline-none border-none text-[color:var(--color-ink-50)] placeholder:text-[color:var(--color-ink-500)]"
              aria-label="Stack command input"
            />
          </div>
        )}
      </div>

      {/* Suggestion chips */}
      {unlocked && (
        <div
          className="flex flex-wrap gap-2 px-4 py-3 border-t border-[color:var(--color-ink-600)]"
          style={{ backgroundColor: "rgba(10, 12, 16, 0.4)" }}
        >
          <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)] mr-2 self-center">
            try
          </span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setInput(s);
                inputRef.current?.focus();
              }}
              className="mono text-[10px] tracking-[0.1em] px-2 py-1 border border-[color:var(--color-ink-600)] text-[color:var(--color-ink-300)] hover:border-[color:var(--color-blade-400)] hover:text-[color:var(--color-blade-400)] transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
