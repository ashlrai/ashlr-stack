import { useEffect, useMemo, useRef, useState } from "react";

/**
 * StackOrbit — the hero's right-side visual.
 *
 * Replaces the abstract 3D tier diagram with something that actually answers
 * "what does Stack integrate?" at a glance: all 29 providers in their real
 * brand colors, orbiting a glowing Stack core. Gentle rotation keeps the eye
 * moving without screaming for attention. Every ~15s a scripted "stack apply"
 * pulse fires through a random 6-provider recipe — amber flashes run around
 * the orbits in sequence, simulating the product working live.
 *
 * Hover any logo → orbit pauses, chip pops, tooltip shows `stack add <name>`.
 * Click → navigates to /providers/<slug> (the programmatic pages).
 * prefers-reduced-motion → static snapshot, no rotation, no pulse.
 *
 * Pure SVG + CSS — no WebGL, no R3F. Ships in ~8kb vs the old R3F bundle's
 * ~200kb first paint, and honest-renders on server-side for instant SEO
 * visibility of every provider logo.
 */

interface OrbitProvider {
  slug: string; // simple-icons slug (matches iconPaths key)
  name: string; // CLI name → /providers/[name]
  displayName: string;
  color: string; // hex w/o #
  category: string;
}

interface Props {
  providers: OrbitProvider[];
  iconPaths?: Record<string, string | null>;
}

/** Positioned chip on a ring, with base angle + radius. */
interface PlacedChip extends OrbitProvider {
  radius: number; // % of container half-size (0..50-ish)
  baseAngle: number; // radians
  ring: 0 | 1 | 2;
}

const RING_CONFIG = {
  0: { radius: 27, duration: 160, direction: 1 }, // inner, forward
  1: { radius: 38, duration: 240, direction: -1 }, // middle, backward
  2: { radius: 48, duration: 320, direction: 1 }, // outer, forward
} as const;

/**
 * Distribute the 29 providers across 3 rings so the most recognizable names
 * (Supabase, Stripe, Vercel, Anthropic, GitHub…) land on the inner ring where
 * the eye naturally falls first.
 */
const HEADLINER_PRIORITY: Record<string, number> = {
  supabase: 100,
  vercel: 99,
  anthropic: 98,
  stripe: 97,
  openai: 96,
  github: 95,
  clerk: 90,
  sentry: 89,
  posthog: 88,
  neon: 87,
  cloudflare: 86,
  turso: 80,
};

function place(providers: OrbitProvider[]): PlacedChip[] {
  const sorted = [...providers].sort(
    (a, b) =>
      (HEADLINER_PRIORITY[b.name] ?? 0) - (HEADLINER_PRIORITY[a.name] ?? 0),
  );
  const rings: OrbitProvider[][] = [[], [], []];
  const caps = [6, 10, providers.length - 16]; // 6 + 10 + 13 for 29
  let ring = 0;
  for (const p of sorted) {
    while (rings[ring]!.length >= caps[ring]!) ring++;
    rings[ring]!.push(p);
  }
  const placed: PlacedChip[] = [];
  for (let r = 0; r < 3; r++) {
    const count = rings[r]!.length;
    const offset = r * (Math.PI / count); // stagger each ring slightly
    for (let i = 0; i < count; i++) {
      const baseAngle = (i / count) * Math.PI * 2 + offset;
      placed.push({
        ...rings[r]![i]!,
        ring: r as 0 | 1 | 2,
        radius: RING_CONFIG[r as 0 | 1 | 2].radius,
        baseAngle,
      });
    }
  }
  return placed;
}

export default function StackOrbit({ providers, iconPaths = {} }: Props) {
  const [reduced, setReduced] = useState(false);
  const [pulsing, setPulsing] = useState<Set<string>>(new Set());
  const [recipe, setRecipe] = useState<string[]>([]);
  const pulseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const placed = useMemo(() => place(providers), [providers]);

  // Periodic "stack apply" pulse — fires a random 6-provider recipe every ~15s.
  // Each provider lights up amber for ~600ms, staggered 200ms apart so the
  // pulse reads as a sequential flow.
  useEffect(() => {
    if (reduced) return;
    let cancelled = false;

    function fireRecipe(): void {
      if (cancelled) return;
      const pool = [...placed].sort(() => Math.random() - 0.5).slice(0, 6);
      const names = pool.map((p) => p.name);
      setRecipe(names);
      for (let i = 0; i < pool.length; i++) {
        const target = pool[i]!.name;
        const t1 = setTimeout(() => {
          setPulsing((prev) => new Set(prev).add(target));
        }, i * 220);
        const t2 = setTimeout(
          () => {
            setPulsing((prev) => {
              const next = new Set(prev);
              next.delete(target);
              return next;
            });
          },
          i * 220 + 900,
        );
        pulseTimers.current.push(t1, t2);
      }
      const nextT = setTimeout(fireRecipe, 15000);
      pulseTimers.current.push(nextT);
    }

    // Kick off after a small initial delay so the first pulse isn't simultaneous
    // with the hero's load-in cascade.
    const kickoff = setTimeout(fireRecipe, 4500);
    pulseTimers.current.push(kickoff);

    return () => {
      cancelled = true;
      for (const t of pulseTimers.current) clearTimeout(t);
      pulseTimers.current = [];
    };
  }, [placed, reduced]);

  return (
    <div
      className="stack-orbit relative w-full h-full"
      aria-label="Orbital visualization of the 29 providers Stack integrates"
    >
      {/* Faint orbital guides (SVG circles). */}
      <svg
        viewBox="-100 -100 200 200"
        className="absolute inset-0 w-full h-full"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="orbit-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#e96b2a" stopOpacity="0.45" />
            <stop offset="40%" stopColor="#e96b2a" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#e96b2a" stopOpacity="0" />
          </radialGradient>
          <filter id="orbit-core-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
        </defs>

        {/* Ambient center glow */}
        <circle cx="0" cy="0" r="22" fill="url(#orbit-core-glow)" />

        {/* Orbital rings */}
        <circle cx="0" cy="0" r={RING_CONFIG[0].radius} fill="none" stroke="rgba(245,136,62,0.10)" strokeWidth="0.3" strokeDasharray="1 1.5" />
        <circle cx="0" cy="0" r={RING_CONFIG[1].radius} fill="none" stroke="rgba(245,136,62,0.08)" strokeWidth="0.3" strokeDasharray="1 2" />
        <circle cx="0" cy="0" r={RING_CONFIG[2].radius} fill="none" stroke="rgba(245,136,62,0.06)" strokeWidth="0.3" strokeDasharray="1 2.5" />

        {/* Stack ▲ in the center */}
        <g className="orbit-core" filter="url(#orbit-core-blur)">
          <polygon points="0,-9 9,7 -9,7" fill="none" stroke="#e96b2a" strokeWidth="1.2" strokeLinejoin="miter" />
        </g>
        <polygon points="0,-9 9,7 -9,7" fill="none" stroke="#f5883e" strokeWidth="0.9" strokeLinejoin="miter" />
        <text
          x="0"
          y="24"
          textAnchor="middle"
          fill="#f5883e"
          fontSize="4.5"
          fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
          letterSpacing="0.4"
        >
          STACK
        </text>
      </svg>

      {/* Orbiting logo chips — one group per ring, counter-rotation keeps logos upright. */}
      {[0, 1, 2].map((ringIdx) => {
        const cfg = RING_CONFIG[ringIdx as 0 | 1 | 2];
        const chips = placed.filter((c) => c.ring === ringIdx);
        return (
          <div
            key={ringIdx}
            className={`orbit-ring ring-${ringIdx} absolute inset-0 pointer-events-none`}
            style={{
              animation: reduced
                ? "none"
                : `orbitSpin${cfg.direction > 0 ? "Fwd" : "Rev"} ${cfg.duration}s linear infinite`,
            }}
          >
            {chips.map((chip) => {
              const x = 50 + chip.radius * Math.cos(chip.baseAngle);
              const y = 50 + chip.radius * Math.sin(chip.baseAngle);
              const isPulsing = pulsing.has(chip.name);
              const inCurrentRecipe = recipe.includes(chip.name);
              return (
                <a
                  key={chip.name}
                  href={`/providers/${chip.name}/`}
                  className={`orbit-chip pointer-events-auto absolute group ${isPulsing ? "pulsing" : ""}`}
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    // Counter-rotate so the logo stays upright while the ring spins.
                    animation: reduced
                      ? "none"
                      : `orbitSpin${cfg.direction > 0 ? "Rev" : "Fwd"} ${cfg.duration}s linear infinite`,
                    // anchor the logo at its center
                    transform: "translate(-50%, -50%)",
                  }}
                  title={`stack add ${chip.name}`}
                  aria-label={`${chip.displayName} — stack add ${chip.name}`}
                >
                  <OrbitChip
                    chip={chip}
                    iconPaths={iconPaths}
                    isPulsing={isPulsing}
                    isInRecipe={inCurrentRecipe}
                  />
                </a>
              );
            })}
          </div>
        );
      })}

      {/* Caption below the orbit */}
      <div className="absolute left-3 bottom-3 caption text-[color:var(--color-steel-300)] pointer-events-none">
        29 PROVIDERS · 3 ORBITS
      </div>
      <div className="absolute right-3 bottom-3 caption text-[color:var(--color-blade-400)] mono text-[10px] pointer-events-none">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-blade-400)] mr-1.5" style={{ animation: reduced ? "none" : "orbitCorePulse 2.8s ease-in-out infinite" }} />
        live
      </div>

      <style>{`
        @keyframes orbitSpinFwd {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes orbitSpinRev {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
        @keyframes orbitCorePulse {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.15); }
        }
        .stack-orbit .orbit-core {
          animation: orbitCoreBreathe 3.6s ease-in-out infinite;
          transform-origin: center;
        }
        @keyframes orbitCoreBreathe {
          0%, 100% { opacity: 0.7; }
          50%      { opacity: 1; }
        }
        .stack-orbit .orbit-chip {
          transition: transform 220ms ease;
          will-change: transform;
        }
        .stack-orbit .orbit-chip:hover .chip-body,
        .stack-orbit .orbit-chip:focus-visible .chip-body {
          transform: scale(1.18);
          border-color: var(--color-blade-400);
          background: rgba(233, 107, 42, 0.14);
          box-shadow: 0 6px 24px -4px rgba(233, 107, 42, 0.4);
        }
        .stack-orbit .orbit-ring:hover {
          animation-play-state: paused;
        }
        .stack-orbit .orbit-ring:hover .orbit-chip {
          animation-play-state: paused;
        }
        .stack-orbit .orbit-chip.pulsing .chip-body {
          animation: chipPulse 900ms ease-out;
        }
        @keyframes chipPulse {
          0%   { transform: scale(1);    box-shadow: 0 0 0   0     rgba(233,107,42,0.6); border-color: var(--color-blade-500); }
          40%  { transform: scale(1.22); box-shadow: 0 0 0   14px  rgba(233,107,42,0);   border-color: var(--color-blade-400); }
          100% { transform: scale(1);    box-shadow: 0 0 0   0     rgba(233,107,42,0);   border-color: var(--color-ink-700); }
        }
        @media (prefers-reduced-motion: reduce) {
          .stack-orbit .orbit-core,
          .stack-orbit .orbit-chip,
          .stack-orbit .orbit-ring { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

function OrbitChip({
  chip,
  iconPaths,
  isPulsing,
  isInRecipe,
}: {
  chip: PlacedChip;
  iconPaths: Record<string, string | null>;
  isPulsing: boolean;
  isInRecipe: boolean;
}) {
  const path = iconPaths[chip.slug];
  const size = chip.ring === 0 ? 20 : chip.ring === 1 ? 17 : 15;
  return (
    <div
      className="chip-body inline-flex items-center justify-center rounded-md border backdrop-blur"
      style={{
        width: size + 10,
        height: size + 10,
        backgroundColor: isInRecipe
          ? "rgba(233, 107, 42, 0.06)"
          : "rgba(10, 12, 16, 0.82)",
        borderColor: isPulsing
          ? "var(--color-blade-400)"
          : isInRecipe
            ? "rgba(233, 107, 42, 0.35)"
            : "var(--color-ink-700)",
        transition: "transform 220ms ease, border-color 220ms ease, background 220ms ease, box-shadow 220ms ease",
      }}
    >
      {path ? (
        <svg
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill={isPulsing ? "#f5883e" : `#${chip.color}`}
          aria-hidden="true"
          style={{ transition: "fill 220ms ease", flexShrink: 0 }}
        >
          <path d={path} />
        </svg>
      ) : (
        <span
          className="rounded-full"
          style={{
            width: size * 0.5,
            height: size * 0.5,
            backgroundColor: `#${chip.color}`,
          }}
        />
      )}
    </div>
  );
}
