import { useEffect, useRef, useState } from "react";

/**
 * GenerateStackDemo — the hero "click and see it" demo.
 *
 * Renders as an expandable slot under the copy-pasteable Claude prompt.
 * Click ▶ Play → 6-second scripted animation:
 *   1. `stack recommend "..."` prompt types out
 *   2. 6 real provider chips (with simple-icons logos) stream in
 *   3. `stack apply <id>` stamps each provider with ✓
 *   4. Summary line: providers / secrets / wired time
 *
 * The value prop lands in 6 seconds without the user touching the CLI.
 * Respects prefers-reduced-motion by snapping to the final frame.
 */

interface DemoProvider {
  slug: string;
  name: string;
  category: string;
  color: string; // hex without #
  /** .env var Stack's catalog maps to this provider. One representative is enough for the demo. */
  secrets: number;
}

// Hand-picked canonical SaaS starter. 6 providers keeps the chip strip tight
// at mobile widths without crowding; all are in `packages/core/src/catalog.ts`
// so the demo matches what `stack recommend` would actually return.
const DEMO_STACK: DemoProvider[] = [
  { slug: "supabase",  name: "Supabase",  category: "Database",  color: "3ECF8E", secrets: 3 },
  { slug: "vercel",    name: "Vercel",    category: "Deploy",    color: "FFFFFF", secrets: 1 },
  { slug: "anthropic", name: "Anthropic", category: "AI",        color: "D97757", secrets: 1 },
  { slug: "posthog",   name: "PostHog",   category: "Analytics", color: "F54E00", secrets: 1 },
  { slug: "sentry",    name: "Sentry",    category: "Errors",    color: "362D59", secrets: 4 },
  { slug: "github",    name: "GitHub",    category: "Code",      color: "FFFFFF", secrets: 1 },
];

const DEMO_QUERY =
  'Build me a B2B SaaS with auth, AI, analytics, and error tracking.';

const RECIPE_ID = 'b2b-saas-with-auth-ai-analytics';

interface Props {
  iconPaths?: Record<string, string | null>;
}

type Phase =
  | "idle"
  | "typing"
  | "recommending"
  | "picked"
  | "applying"
  | "done";

export default function GenerateStackDemo({ iconPaths = {} }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [typed, setTyped] = useState("");
  const [visibleCount, setVisibleCount] = useState(0);
  const [appliedCount, setAppliedCount] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reducedRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      reducedRef.current = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
    }
    return () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
    };
  }, []);

  function schedule(fn: () => void, delay: number): void {
    const t = setTimeout(fn, delay);
    timersRef.current.push(t);
  }

  function reset(): void {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
    setTyped("");
    setVisibleCount(0);
    setAppliedCount(0);
    setPhase("idle");
  }

  function play(): void {
    reset();

    if (reducedRef.current) {
      // Snap to done state — all chips visible + stamped, no animation.
      setTyped(DEMO_QUERY);
      setVisibleCount(DEMO_STACK.length);
      setAppliedCount(DEMO_STACK.length);
      setPhase("done");
      return;
    }

    setPhase("typing");
    // Type the prompt character-by-character.
    const charDelay = 24;
    for (let i = 1; i <= DEMO_QUERY.length; i++) {
      schedule(() => setTyped(DEMO_QUERY.slice(0, i)), i * charDelay);
    }
    const typingDone = DEMO_QUERY.length * charDelay + 220;

    // Switch to recommend phase; chips stream in.
    schedule(() => setPhase("recommending"), typingDone);
    for (let i = 0; i < DEMO_STACK.length; i++) {
      schedule(
        () => setVisibleCount(i + 1),
        typingDone + 400 + i * 220,
      );
    }
    const recommendDone = typingDone + 400 + DEMO_STACK.length * 220 + 180;

    // Apply phase — stamp each chip.
    schedule(() => setPhase("applying"), recommendDone);
    for (let i = 0; i < DEMO_STACK.length; i++) {
      schedule(
        () => setAppliedCount(i + 1),
        recommendDone + 260 + i * 260,
      );
    }
    const applyDone = recommendDone + 260 + DEMO_STACK.length * 260 + 200;

    schedule(() => setPhase("done"), applyDone);
  }

  const showOutput = phase !== "idle";
  const totalSecrets = DEMO_STACK.reduce((acc, p) => acc + p.secrets, 0);

  return (
    <div className="generate-stack-demo mt-4 panel-steel" style={{ borderLeft: "2px solid var(--color-blade-500)" }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 hairline-bottom">
        <div className="flex items-center gap-2 min-w-0">
          <span className="mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-blade-400)]">
            live demo
          </span>
          <span className="text-[color:var(--color-ink-600)]">·</span>
          <span className="text-[11px] text-[color:var(--color-ink-400)] truncate">
            one prompt, six providers wired
          </span>
        </div>
        <button
          type="button"
          onClick={phase === "idle" || phase === "done" ? play : undefined}
          disabled={phase !== "idle" && phase !== "done"}
          className="inline-flex items-center gap-2 px-3 py-1.5 border border-[color:var(--color-blade-500)] text-[11px] tracking-[0.12em] uppercase text-[color:var(--color-ink-50)] bg-[color:var(--color-blade-500)]/10 hover:bg-[color:var(--color-blade-500)]/20 transition-colors disabled:opacity-40 disabled:cursor-wait flex-shrink-0"
          aria-label={phase === "done" ? "Replay stack generation demo" : "Play stack generation demo"}
        >
          {phase === "idle" && <><span>▶</span><span>Generate a stack</span></>}
          {phase === "done" && <><span>↻</span><span>Replay</span></>}
          {phase !== "idle" && phase !== "done" && <><span>●</span><span>Generating…</span></>}
        </button>
      </div>

      <div className="px-4 py-4 mono text-[12.5px] leading-[1.75] text-[color:var(--color-ink-200)]">
        {/* Prompt line — always visible once demo starts */}
        <div className="flex gap-2">
          <span className="text-[color:var(--color-blade-400)] flex-shrink-0">you ›</span>
          <span className="whitespace-pre-wrap break-words">
            stack recommend "{phase === "idle" ? DEMO_QUERY : typed}
            {phase === "typing" && <span className="caret" aria-hidden="true" />}
            "
          </span>
        </div>

        {/* Output region */}
        {showOutput && (
          <div className="mt-3 space-y-2">
            {/* Recommend status line */}
            {(phase === "recommending" || phase === "picked" || phase === "applying" || phase === "done") && (
              <div className="flex items-center gap-2 text-[color:var(--color-ink-400)]">
                <span className="text-[color:var(--color-blade-400)]">○</span>
                <span>stack recommend → retrieving top providers…</span>
                {(phase === "applying" || phase === "done") && (
                  <span className="text-[color:var(--color-ink-500)]">done</span>
                )}
              </div>
            )}

            {/* Provider chip strip */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {DEMO_STACK.map((p, i) => {
                const isVisible = i < visibleCount;
                const isApplied = i < appliedCount;
                if (!isVisible) return null;
                const path = iconPaths[p.slug];
                return (
                  <span
                    key={p.slug}
                    className="chip-in inline-flex items-center gap-1.5 px-2 py-1 border border-[color:var(--color-ink-600)] text-[11px] tracking-[0.04em]"
                    style={{
                      background: isApplied ? "rgba(74, 222, 128, 0.06)" : undefined,
                      borderColor: isApplied ? "#4ade80" : undefined,
                      color: isApplied ? "#4ade80" : "var(--color-ink-100)",
                      transition: "border-color 180ms ease, background 180ms ease, color 180ms ease",
                    }}
                    title={`${p.name} — ${p.category}`}
                  >
                    {path ? (
                      <svg
                        viewBox="0 0 24 24"
                        width="11"
                        height="11"
                        fill={isApplied ? "#4ade80" : `#${p.color}`}
                        aria-hidden="true"
                        style={{ flexShrink: 0, transition: "fill 180ms ease" }}
                      >
                        <path d={path} />
                      </svg>
                    ) : (
                      <span
                        className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                        style={{ backgroundColor: isApplied ? "#4ade80" : `#${p.color}` }}
                      />
                    )}
                    <span>{p.name}</span>
                    {isApplied && <span aria-hidden="true">✓</span>}
                  </span>
                );
              })}
            </div>

            {/* Apply status line */}
            {(phase === "applying" || phase === "done") && (
              <div className="flex items-center gap-2 text-[color:var(--color-ink-400)] pt-2">
                <span className="text-[color:var(--color-blade-400)]">○</span>
                <span>stack apply {RECIPE_ID} → provisioning, vaulting secrets in Phantom…</span>
                {phase === "done" && (
                  <span className="text-[color:var(--color-ink-500)]">done</span>
                )}
              </div>
            )}

            {/* Summary */}
            {phase === "done" && (
              <div className="pt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[color:var(--color-ink-300)]">
                <span className="text-[color:var(--color-blade-400)]">✓</span>
                <span>
                  <span className="text-[color:var(--color-ink-50)] font-semibold">{DEMO_STACK.length}</span> providers wired
                </span>
                <span className="text-[color:var(--color-ink-600)]">·</span>
                <span>
                  <span className="text-[color:var(--color-ink-50)] font-semibold">{totalSecrets}</span> secrets in{" "}
                  <a
                    href="https://phm.dev"
                    target="_blank"
                    rel="noopener"
                    className="text-[color:var(--color-ink-100)] underline decoration-dotted decoration-[#3b82f6]/40 underline-offset-4 hover:decoration-[#3b82f6] hover:text-[#3b82f6] transition-colors"
                  >
                    Phantom
                  </a>
                </span>
                <span className="text-[color:var(--color-ink-600)]">·</span>
                <span>
                  <span className="mono text-[color:var(--color-ink-100)]">.env</span> +{" "}
                  <span className="mono text-[color:var(--color-ink-100)]">.mcp.json</span> written
                </span>
                <a
                  href="#providers"
                  className="ml-auto text-[11px] tracking-[0.08em] uppercase text-[color:var(--color-blade-400)] hover:text-[color:var(--color-blade-300)]"
                >
                  Try your own →
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        .generate-stack-demo .caret {
          display: inline-block;
          width: 0.5em;
          height: 1em;
          margin-left: 1px;
          background: currentColor;
          vertical-align: text-bottom;
          animation: caretBlink 0.9s steps(1) infinite;
        }
        @keyframes caretBlink {
          0%, 50% { opacity: 1; }
          50.01%, 100% { opacity: 0; }
        }
        .generate-stack-demo .chip-in {
          animation: chipIn 220ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
        }
        @keyframes chipIn {
          from { opacity: 0; transform: translateY(4px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .generate-stack-demo .chip-in { animation: none; }
          .generate-stack-demo .caret { animation: none; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
