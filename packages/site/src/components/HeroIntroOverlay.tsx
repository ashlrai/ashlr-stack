import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "~/lib/use-prefers-reduced-motion";

/**
 * HeroIntroOverlay — cinematic ~8s intro that plays once per session, then
 * fades to reveal the interactive 3D beneath. Pure SVG + CSS keyframes,
 * orchestrated by a React state machine. No video file, no heavy deps.
 *
 * Scene beats:
 *   0.0s  — black, ink-950 field
 *   0.3s  — amber spark ignites at center
 *   0.8s  — spark fragments into 8 points of light (one per tier)
 *   1.3s  — points resolve into 8 horizontal plate silhouettes (staggered)
 *   2.3s  — title types in: "Wire your entire dev stack."
 *   3.3s  — subtitle: "In one command."
 *   4.3s  — five provider logos fade/orbit into view
 *   5.3s  — CLI line types in:  › stack add supabase
 *   6.3s  — four green checkmarks fire (one per beat, 180ms apart)
 *   7.5s  — amber wash + fade to the 3D scene beneath
 *
 * Session-sticky via sessionStorage["stack-intro-seen"]. Reduced-motion
 * skips to the final frame and immediately dismisses.
 */

const STORAGE_KEY = "stack-intro-seen";
const TOTAL_MS = 8200;

const SEQUENCE = {
  spark: 300,
  fragment: 800,
  plates: 1300,
  title: 2300,
  subtitle: 3300,
  orbits: 4300,
  cliStart: 5300,
  checksStart: 6300,
  fade: 7500,
} as const;

interface PlateStub {
  y: number;
  w: number;
  accent?: boolean;
  glyph: string;
  label: string;
}
const PLATES: PlateStub[] = [
  { y: 0, w: 62, glyph: "◇", label: "HUMAN / AGENT" },
  { y: 36, w: 68, glyph: "⊞", label: "CLI / MCP" },
  { y: 72, w: 74, glyph: "∴", label: "AI APIS" },
  { y: 108, w: 78, glyph: "◉", label: "OBSERVABILITY" },
  { y: 144, w: 80, glyph: "▲", label: "DEPLOY" },
  { y: 180, w: 78, glyph: "▦", label: "DATABASES" },
  { y: 216, w: 74, glyph: "⊕", label: "AUTH" },
  { y: 252, w: 68, glyph: "◈", label: "PHANTOM", accent: true },
];

const ORBITS = [
  { brand: "#3ECF8E", label: "supabase", theta: -60 },
  { brand: "#00E699", label: "neon", theta: 60 },
  { brand: "#D97757", label: "anthropic", theta: -140 },
  { brand: "#F54E00", label: "posthog", theta: 140 },
  { brand: "#FFFFFF", label: "vercel", theta: 180 },
];

export default function HeroIntroOverlay() {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<"idle" | "playing" | "fading" | "done">("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (reduced || sessionStorage.getItem(STORAGE_KEY) === "1") {
      setPhase("done");
      return;
    }
    setPhase("playing");
    let cancelled = false;
    const fadeT = setTimeout(() => {
      if (!cancelled) setPhase("fading");
    }, SEQUENCE.fade);
    const doneT = setTimeout(() => {
      if (cancelled) return;
      sessionStorage.setItem(STORAGE_KEY, "1");
      setPhase("done");
    }, TOTAL_MS);
    timers.current = [fadeT, doneT];
    return () => {
      cancelled = true;
      clearTimeout(fadeT);
      clearTimeout(doneT);
      timers.current = [];
    };
  }, [reduced]);

  const skip = () => {
    sessionStorage.setItem(STORAGE_KEY, "1");
    setPhase("done");
  };

  if (phase === "done") return null;

  return (
    <div
      role="dialog"
      aria-label="Ashlr Stack intro"
      className="absolute inset-0 z-20 overflow-hidden pointer-events-auto select-none"
      style={{
        backgroundColor: "rgba(5, 7, 10, 0.97)",
        opacity: phase === "fading" ? 0 : 1,
        transition: "opacity 700ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      {/* Grid backdrop */}
      <div
        className="absolute inset-0 cad-grid opacity-40 pointer-events-none"
        aria-hidden="true"
      />

      {/* CENTERED STAGE */}
      <svg
        viewBox="0 0 600 720"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full"
        role="img"
        aria-label="Intro animation"
      >
        <title>Intro animation</title>
        <defs>
          <radialGradient id="spark-grad">
            <stop offset="0%" stopColor="#fbe1cf" stopOpacity="1" />
            <stop offset="40%" stopColor="#f5883e" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#e96b2a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="plate-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#1e2630" />
            <stop offset="100%" stopColor="#131820" />
          </linearGradient>
          <linearGradient id="plate-accent" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#3a2010" />
            <stop offset="100%" stopColor="#241008" />
          </linearGradient>
          <filter id="spark-glow">
            <feGaussianBlur stdDeviation="8" />
          </filter>
        </defs>

        {/* Amber spark — pre-fragment */}
        <g className="intro-spark">
          <circle cx="300" cy="360" r="40" fill="url(#spark-grad)" filter="url(#spark-glow)" />
          <circle cx="300" cy="360" r="6" fill="#fbe1cf" />
        </g>

        {/* 8 plate silhouettes, staggered assembly */}
        <g className="intro-plates">
          {PLATES.map((p, i) => {
            const px = 300 - p.w * 2;
            const py = 216 + p.y;
            return (
              <g key={p.y} className="intro-plate" style={{ animationDelay: `${1300 + i * 55}ms` }}>
                <rect
                  x={px}
                  y={py}
                  width={p.w * 4}
                  height={28}
                  fill={p.accent ? "url(#plate-accent)" : "url(#plate-grad)"}
                  stroke={p.accent ? "#f5883e" : "#39556f"}
                  strokeWidth="1"
                />
                <rect x={px} y={py} width="3" height="28" fill={p.accent ? "#f5883e" : "#6b8097"} />
                <text
                  x={px + 14}
                  y={py + 18}
                  fill={p.accent ? "#f9a877" : "#c4ccd5"}
                  fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
                  fontSize="10"
                  letterSpacing="1.2"
                >
                  {p.glyph} {p.label}
                </text>
                <text
                  x={px + p.w * 4 - 14}
                  y={py + 18}
                  fill={p.accent ? "#f5883e" : "#6b8097"}
                  fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
                  fontSize="11"
                  textAnchor="end"
                  letterSpacing="1.2"
                >
                  {String(8 - i).padStart(2, "0")}
                </text>
              </g>
            );
          })}
        </g>

        {/* Amber pool glow under Phantom */}
        <ellipse
          className="intro-pool"
          cx="300"
          cy="528"
          rx="180"
          ry="14"
          fill="#e96b2a"
          opacity="0.2"
        />

        {/* Orbit ring + provider dots */}
        <g className="intro-orbits">
          <circle
            cx="300"
            cy="416"
            r="180"
            fill="none"
            stroke="#f5883e"
            strokeOpacity="0.2"
            strokeWidth="1"
          />
          {ORBITS.map((o, i) => {
            const rad = (o.theta * Math.PI) / 180;
            const ox = 300 + Math.cos(rad) * 180;
            const oy = 416 + Math.sin(rad) * 80;
            return (
              <g
                key={o.label}
                className="intro-orbit-dot"
                style={{ animationDelay: `${4300 + i * 130}ms` }}
              >
                <circle cx={ox} cy={oy} r="7" fill={o.brand} opacity="0.9" />
                <circle cx={ox} cy={oy} r="13" fill={o.brand} opacity="0.15" />
                <text
                  x={ox}
                  y={oy - 18}
                  fill="#e1e5ea"
                  fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
                  fontSize="9"
                  textAnchor="middle"
                  letterSpacing="1.1"
                >
                  {o.label.toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>

        {/* Title + subtitle */}
        <g className="intro-copy">
          <text
            className="intro-title"
            x="300"
            y="110"
            fill="#f4f5f7"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize="28"
            fontWeight="600"
            textAnchor="middle"
            letterSpacing="-0.01em"
          >
            Wire your entire dev stack.
          </text>
          <text
            className="intro-subtitle"
            x="300"
            y="150"
            fill="#f5883e"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize="28"
            fontWeight="600"
            fontStyle="italic"
            textAnchor="middle"
            letterSpacing="-0.01em"
          >
            In one command.
          </text>
        </g>

        {/* CLI line */}
        <g className="intro-cli">
          <rect
            x="130"
            y="610"
            width="340"
            height="44"
            fill="rgba(10,12,16,0.9)"
            stroke="#e96b2a"
            strokeWidth="1"
          />
          <text
            x="148"
            y="638"
            fill="#f5883e"
            fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
            fontSize="14"
          >
            ›
          </text>
          <text
            className="intro-cli-text"
            x="166"
            y="638"
            fill="#e1e5ea"
            fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
            fontSize="14"
          >
            stack add supabase
          </text>
        </g>

        {/* Green checkmarks */}
        <g className="intro-checks">
          {["provision", "auth PKCE", "secrets → phantom", "mcp wired"].map((label, i) => (
            <g
              key={label}
              className="intro-check"
              style={{ animationDelay: `${6300 + i * 180}ms` }}
            >
              <text
                x="148"
                y={684 + i * 8}
                fill="#6fe8a7"
                fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
                fontSize="9"
                letterSpacing="0.08em"
              >
                ✓ {label}
              </text>
            </g>
          ))}
        </g>
      </svg>

      {/* Skip button */}
      <button
        type="button"
        onClick={skip}
        className="absolute top-3 right-3 mono text-[10px] tracking-[0.14em] uppercase px-3 py-1.5 border border-[color:var(--color-blade-500)] text-[color:var(--color-blade-400)] hover:bg-[color:var(--color-blade-500)] hover:text-[color:var(--color-ink-950)] transition-colors"
      >
        skip intro →
      </button>

      {/* Beat indicator — bottom */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
        <span className="mono text-[9px] tracking-[0.18em] uppercase text-[color:var(--color-ink-500)]">
          § · intro · stk-01
        </span>
        <div className="flex gap-1">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span
              key={i}
              className="intro-beat w-2 h-1 bg-[color:var(--color-ink-600)]"
              style={{ animationDelay: `${1000 + i * 800}ms` }}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes introSparkIn {
          0%   { transform: scale(0) translateZ(0); opacity: 0; }
          40%  { transform: scale(1.4); opacity: 1; }
          80%  { transform: scale(1); opacity: 0.9; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes introPlateIn {
          from { opacity: 0; transform: translateY(-24px) scaleX(0.4); }
          to   { opacity: 1; transform: translateY(0)     scaleX(1); }
        }
        @keyframes introCopyIn {
          0%   { opacity: 0; transform: translateY(8px); }
          40%  { opacity: 1; transform: translateY(0); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes introOrbit {
          from { opacity: 0; transform: scale(0.3); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes introCliType {
          0%   { clip-path: inset(0 100% 0 0); }
          100% { clip-path: inset(0 0 0 0); }
        }
        @keyframes introCheckPop {
          0%   { opacity: 0; transform: translateX(-8px); }
          70%  { opacity: 1; transform: translateX(0); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes introBeat {
          0%   { background-color: var(--color-ink-600); }
          30%  { background-color: var(--color-blade-500); }
          100% { background-color: var(--color-ink-600); }
        }
        @keyframes introPoolPulse {
          0%   { opacity: 0; }
          50%  { opacity: 0.3; }
          100% { opacity: 0.15; }
        }
        .intro-spark { transform-origin: 300px 360px; animation: introSparkIn 1300ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }
        .intro-plate { transform-origin: 300px 216px; animation: introPlateIn 520ms cubic-bezier(0.22, 1, 0.36, 1) both; opacity: 0; }
        .intro-pool { animation: introPoolPulse 2400ms 2000ms ease-out both; }
        .intro-orbit-dot { transform-origin: 300px 416px; animation: introOrbit 360ms cubic-bezier(0.22, 1, 0.36, 1) both; opacity: 0; }
        .intro-title { animation: introCopyIn 800ms 2300ms cubic-bezier(0.22, 1, 0.36, 1) both; opacity: 0; }
        .intro-subtitle { animation: introCopyIn 800ms 3300ms cubic-bezier(0.22, 1, 0.36, 1) both; opacity: 0; }
        .intro-cli { animation: introCopyIn 400ms 5300ms cubic-bezier(0.22, 1, 0.36, 1) both; opacity: 0; }
        .intro-cli-text { animation: introCliType 900ms 5500ms steps(24, end) both; }
        .intro-check { animation: introCheckPop 260ms cubic-bezier(0.22, 1, 0.36, 1) both; opacity: 0; }
        .intro-beat { animation: introBeat 600ms ease-out both; }

        @media (prefers-reduced-motion: reduce) {
          .intro-spark, .intro-plate, .intro-pool, .intro-orbit-dot,
          .intro-title, .intro-subtitle, .intro-cli, .intro-cli-text,
          .intro-check, .intro-beat {
            animation: none !important;
            opacity: 1 !important;
          }
        }
      `}</style>
    </div>
  );
}
