import { useEffect, useMemo, useState } from "react";

/**
 * DemoReel — scripted, looping terminal reel that replays a short Stack
 * session end-to-end:
 *
 *   1. `stack init`
 *   2. `stack add supabase`
 *   3. `stack exec -- bun dev`
 *
 * Shares visual DNA with `<Terminal />` (same titlebar, same ansi palette,
 * same spinner-to-check pattern for "work" rows) but leans slower and
 * fully loops — the hero terminal runs once; this one runs until the page
 * closes.
 *
 * Respects `prefers-reduced-motion`: snaps to the last frame and stops
 * looping. Exposes `role="img"` + an `aria-label` for screen readers.
 */

type Step =
  | { kind: "prompt"; text: string; speed?: number }
  | { kind: "out"; text: string; className?: string }
  | { kind: "work"; label: string; duration?: number; detail?: string }
  | { kind: "blank" }
  | { kind: "pause"; ms: number };

const SCRIPT: Step[] = [
  // ── stack init ─────────────────────────────────────────────────────────
  { kind: "prompt", text: "stack init", speed: 48 },
  { kind: "blank" },
  {
    kind: "out",
    text: "▲ stack  initialising · ~/projects/raven",
    className: "ansi-white",
  },
  { kind: "blank" },
  {
    kind: "work",
    label: "writing .stack.toml · .stack.local.toml",
    duration: 650,
    detail: "appended .stack.local.toml to .gitignore",
  },
  {
    kind: "work",
    label: "registering project · ~/.stack/projects.json",
    duration: 420,
  },
  { kind: "blank" },
  {
    kind: "out",
    text: "✓ ready · next: stack add <provider>",
    className: "ansi-green",
  },
  { kind: "pause", ms: 900 },

  // ── stack add supabase ─────────────────────────────────────────────────
  { kind: "blank" },
  { kind: "prompt", text: "stack add supabase", speed: 42 },
  { kind: "blank" },
  {
    kind: "out",
    text: "▲ stack  adding supabase",
    className: "ansi-white",
  },
  { kind: "blank" },
  {
    kind: "work",
    label: "OAuth via browser · PKCE",
    duration: 900,
    detail: "signed in as mason@evero-consulting.com",
  },
  {
    kind: "work",
    label: "provisioning project  raven-prod · us-east-1",
    duration: 1300,
    detail: "db.abc123def.supabase.co",
  },
  {
    kind: "work",
    label: "writing 3 secrets → phantom vault",
    duration: 620,
    detail: "SUPABASE_URL · ANON_KEY · SERVICE_ROLE_KEY",
  },
  {
    kind: "work",
    label: "patching .env.local · .mcp.json · .stack.toml",
    duration: 540,
  },
  {
    kind: "work",
    label: "installing @supabase/supabase-js",
    duration: 820,
  },
  { kind: "blank" },
  {
    kind: "out",
    text: "✓ supabase ready · 4.2s",
    className: "ansi-green",
  },
  {
    kind: "out",
    text: "  next: stack exec -- bun dev",
    className: "ansi-dim",
  },
  { kind: "pause", ms: 1100 },

  // ── stack exec -- bun dev ──────────────────────────────────────────────
  { kind: "blank" },
  { kind: "prompt", text: "stack exec -- bun dev", speed: 42 },
  { kind: "blank" },
  {
    kind: "out",
    text: "▲ stack  resolving 3 phm_ tokens via phantom",
    className: "ansi-dim",
  },
  {
    kind: "out",
    text: "✓ secrets injected · spawning bun dev",
    className: "ansi-green",
  },
  { kind: "blank" },
  {
    kind: "out",
    text: "$ bun dev",
    className: "ansi-dim",
  },
  {
    kind: "out",
    text: "Next.js 15.0.3 · ready on http://localhost:3000",
    className: "ansi-cyan",
  },
  { kind: "pause", ms: 2400 },
];

const LOOP_GAP_MS = 1200;

interface RenderedStep {
  id: number;
  kind: Exclude<Step["kind"], "pause">;
  text: string;
  className?: string;
  detail?: string;
  done?: boolean;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function wait(ms: number, signal: { cancelled: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (signal.cancelled) return resolve();
      if (performance.now() - start >= ms) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
}

export default function DemoReel() {
  const reduced = usePrefersReducedMotion();
  const [lines, setLines] = useState<RenderedStep[]>([]);
  const [typing, setTyping] = useState<string>("");
  const [cycle, setCycle] = useState(0);

  const finalLines = useMemo<RenderedStep[]>(
    () =>
      SCRIPT.filter((s) => s.kind !== "pause").map((s, i) => {
        if (s.kind === "prompt")
          return { id: i, kind: "prompt", text: s.text };
        if (s.kind === "out")
          return { id: i, kind: "out", text: s.text, className: s.className };
        if (s.kind === "work")
          return {
            id: i,
            kind: "work",
            text: s.label,
            detail: s.detail,
            done: true,
          };
        return { id: i, kind: "blank", text: "" };
      }),
    [],
  );

  useEffect(() => {
    if (reduced) {
      setLines(finalLines);
      setTyping("");
      return;
    }

    const signal = { cancelled: false };

    const run = async () => {
      while (!signal.cancelled) {
        const pushed: RenderedStep[] = [];
        setLines([]);
        setTyping("");

        for (let i = 0; i < SCRIPT.length; i++) {
          if (signal.cancelled) return;
          const step = SCRIPT[i]!;

          if (step.kind === "prompt") {
            for (let j = 0; j <= step.text.length; j++) {
              if (signal.cancelled) return;
              setTyping(step.text.slice(0, j));
              await wait(step.speed ?? 36, signal);
            }
            pushed.push({ id: i, kind: "prompt", text: step.text });
            setLines([...pushed]);
            setTyping("");
            await wait(220, signal);
          } else if (step.kind === "out") {
            pushed.push({
              id: i,
              kind: "out",
              text: step.text,
              className: step.className,
            });
            setLines([...pushed]);
            await wait(80, signal);
          } else if (step.kind === "blank") {
            pushed.push({ id: i, kind: "blank", text: "" });
            setLines([...pushed]);
            await wait(40, signal);
          } else if (step.kind === "pause") {
            await wait(step.ms, signal);
          } else if (step.kind === "work") {
            pushed.push({
              id: i,
              kind: "work",
              text: step.label,
              detail: step.detail,
              done: false,
            });
            setLines([...pushed]);
            await wait(step.duration ?? 700, signal);
            if (signal.cancelled) return;
            pushed[pushed.length - 1] = {
              ...pushed[pushed.length - 1]!,
              done: true,
            };
            setLines([...pushed]);
            await wait(120, signal);
          }
        }

        // End-of-loop pause, then reset for the next cycle.
        await wait(LOOP_GAP_MS, signal);
        if (signal.cancelled) return;
        setCycle((c) => c + 1);
      }
    };

    run();
    return () => {
      signal.cancelled = true;
    };
    // `cycle` intentionally not in deps — run is a single long-lived loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, finalLines]);

  return (
    <div
      role="img"
      aria-label="Terminal reel: stack init creates a project, stack add supabase provisions a Supabase project and writes secrets into Phantom, stack exec -- bun dev runs the Next.js dev server with secrets injected."
      className="relative w-full overflow-hidden rounded-2xl panel shadow-[0_40px_120px_-40px_rgba(217,70,239,0.28)]"
    >
      {/* Glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-2xl"
        style={{
          background:
            "radial-gradient(700px 220px at 50% -10%, rgba(217,70,239,0.16), transparent 60%)",
        }}
      />

      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 h-10 hairline-bottom">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 text-center text-xs text-ink-400 mono tracking-wide select-none">
          ~ / projects / raven  —  stack demo reel
        </div>
        <div className="text-[10px] text-ink-500 mono uppercase tracking-widest hidden sm:block">
          loop · {cycle + 1}
        </div>
      </div>

      {/* Content */}
      <div
        className="px-5 py-5 font-mono text-[13px] leading-[1.7] min-h-[440px] sm:min-h-[520px] max-h-[580px] overflow-hidden"
        aria-hidden={!reduced}
      >
        {lines.map((l) => (
          <Line key={`${cycle}-${l.id}`} line={l} />
        ))}
        {typing && (
          <div className="flex gap-2">
            <span className="ansi-magenta select-none">$</span>
            <span className="ansi-white caret">{typing}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ line }: { line: RenderedStep }) {
  if (line.kind === "blank") {
    return <div aria-hidden className="h-[1.7em]" />;
  }

  if (line.kind === "prompt") {
    return (
      <div className="flex gap-2">
        <span className="ansi-magenta select-none">$</span>
        <span className="ansi-white">{line.text}</span>
      </div>
    );
  }

  if (line.kind === "out") {
    return (
      <div className={`whitespace-pre ${line.className ?? "ansi-white"}`}>
        {line.text}
      </div>
    );
  }

  // work row
  return (
    <div className="flex items-start gap-2">
      <span className="mt-[0.12em] w-4 h-4 inline-flex items-center justify-center flex-none">
        {line.done ? (
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path
              d="M2.5 7.5 L5.5 10.5 L11.5 4"
              stroke="#4ade80"
              strokeWidth="1.75"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            aria-hidden
            className="animate-spin"
            style={{ animationDuration: "1.2s" }}
          >
            <circle
              cx="7"
              cy="7"
              r="5"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1.5"
              fill="none"
            />
            <path
              d="M7 2 A5 5 0 0 1 12 7"
              stroke="#e879f9"
              strokeWidth="1.75"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div className="ansi-white">{line.text}</div>
        {line.detail && line.done && (
          <div className="ansi-dim text-[12px] truncate">{line.detail}</div>
        )}
      </div>
    </div>
  );
}
