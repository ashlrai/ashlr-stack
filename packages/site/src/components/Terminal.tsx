import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Terminal — typing + streaming output for the hero.
 *
 * A sequence of "steps" is animated. Each step is either:
 *   - a user prompt line typed character-by-character
 *   - an instant output line (streamed)
 *   - a "work" line that flips from spinner → check
 *
 * Respects prefers-reduced-motion (falls back to fully rendered).
 */

type Step =
  | { kind: "prompt"; text: string; speed?: number }
  | { kind: "out"; text: string; className?: string }
  | { kind: "work"; label: string; duration?: number; detail?: string }
  | { kind: "blank" };

const SCRIPT: Step[] = [
  { kind: "prompt", text: "stack add supabase", speed: 42 },
  { kind: "blank" },
  {
    kind: "out",
    text: "▲ stack  adding supabase · to ~/projects/raven",
    className: "ansi-white",
  },
  { kind: "blank" },
  {
    kind: "work",
    label: "opening browser for Supabase OAuth",
    duration: 900,
    detail: "signed in as mason@evero-consulting.com",
  },
  {
    kind: "work",
    label: "creating project  raven-prod · region us-east-1",
    duration: 1400,
    detail: "db.abc123def.supabase.co",
  },
  {
    kind: "work",
    label: "writing secrets to phantom vault",
    duration: 700,
    detail: "SUPABASE_URL · ANON_KEY · SERVICE_ROLE_KEY",
  },
  {
    kind: "work",
    label: "patching .env.local · .mcp.json · .stack.toml",
    duration: 600,
  },
  {
    kind: "work",
    label: "installing @supabase/supabase-js",
    duration: 900,
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
];

interface RenderedStep {
  id: number;
  kind: Step["kind"];
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

export default function Terminal() {
  const reduced = usePrefersReducedMotion();
  const [lines, setLines] = useState<RenderedStep[]>([]);
  const [typing, setTyping] = useState<string>("");
  const [done, setDone] = useState(false);
  const cancelRef = useRef(false);

  const finalLines = useMemo<RenderedStep[]>(
    () =>
      SCRIPT.map((s, i) => {
        if (s.kind === "prompt") {
          return { id: i, kind: "prompt", text: s.text };
        }
        if (s.kind === "out") {
          return { id: i, kind: "out", text: s.text, className: s.className };
        }
        if (s.kind === "work") {
          return {
            id: i,
            kind: "work",
            text: s.label,
            detail: s.detail,
            done: true,
          };
        }
        return { id: i, kind: "blank", text: "" };
      }),
    [],
  );

  useEffect(() => {
    if (reduced) {
      setLines(finalLines);
      setDone(true);
      return;
    }

    cancelRef.current = false;

    const run = async () => {
      const pushed: RenderedStep[] = [];
      for (let i = 0; i < SCRIPT.length; i++) {
        if (cancelRef.current) return;
        const step = SCRIPT[i]!;

        if (step.kind === "prompt") {
          for (let j = 0; j <= step.text.length; j++) {
            if (cancelRef.current) return;
            setTyping(step.text.slice(0, j));
            await wait(step.speed ?? 36);
          }
          pushed.push({
            id: i,
            kind: "prompt",
            text: step.text,
          });
          setLines([...pushed]);
          setTyping("");
          await wait(220);
        } else if (step.kind === "out") {
          pushed.push({
            id: i,
            kind: "out",
            text: step.text,
            className: step.className,
          });
          setLines([...pushed]);
          await wait(90);
        } else if (step.kind === "blank") {
          pushed.push({ id: i, kind: "blank", text: "" });
          setLines([...pushed]);
          await wait(40);
        } else if (step.kind === "work") {
          // push as in-progress
          pushed.push({
            id: i,
            kind: "work",
            text: step.label,
            detail: step.detail,
            done: false,
          });
          setLines([...pushed]);
          await wait(step.duration ?? 700);
          if (cancelRef.current) return;
          pushed[pushed.length - 1] = {
            ...pushed[pushed.length - 1]!,
            done: true,
          };
          setLines([...pushed]);
          await wait(120);
        }
      }
      setDone(true);
    };

    run();
    return () => {
      cancelRef.current = true;
    };
  }, [finalLines, reduced]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl panel shadow-[0_40px_120px_-40px_rgba(217,70,239,0.25)]"
      aria-label="Live terminal preview of stack add supabase"
    >
      {/* Glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-2xl"
        style={{
          background:
            "radial-gradient(600px 200px at 20% -10%, rgba(217,70,239,0.18), transparent 60%)",
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
          ~ / projects / raven  —  stack
        </div>
        <div className="text-[10px] text-ink-500 mono uppercase tracking-widest hidden sm:block">
          bash
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-5 font-mono text-[13px] leading-[1.7] min-h-[380px] sm:min-h-[440px]">
        {lines.map((l) => (
          <Line key={l.id} line={l} />
        ))}
        {typing && (
          <div className="flex gap-2">
            <span className="ansi-magenta select-none">$</span>
            <span className="ansi-white caret">{typing}</span>
          </div>
        )}
        {done && !reduced && (
          <div className="flex gap-2 mt-1">
            <span className="ansi-magenta select-none">$</span>
            <span className="ansi-white caret" />
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

  // work
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
              stroke="#f5883e"
              strokeWidth="1.75"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div className={line.done ? "ansi-white" : "ansi-white"}>
          {line.text}
        </div>
        {line.detail && line.done && (
          <div className="ansi-dim text-[12px] truncate">{line.detail}</div>
        )}
      </div>
    </div>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
