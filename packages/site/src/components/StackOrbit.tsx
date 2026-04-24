import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * StackOrbit — the hero's right-side visual.
 *
 * 29 real provider logos orbiting a glowing Stack core in 3 rings. Every ~15s
 * (and on demand when the core is clicked) a scripted "stack apply" pulse
 * fires: rings freeze, 6 random chips pulse amber in sequence, and thin amber
 * lines draw from the core out to each pulsing chip. A mono recipe label
 * ("▶ stack apply supabase-vercel-anthropic-b2b") fades in at the top.
 *
 * First render kicks off an entrance cascade — outer → middle → inner ring
 * chips zoom in from outside the panel over ~1500ms, with the Stack ▲ lighting
 * up last as everything settles.
 *
 * prefers-reduced-motion → static snapshot, no cascade/pulse/lines/label.
 * Pure SVG + CSS — no WebGL, no Canvas, no framer-motion.
 */

interface OrbitProvider {
  slug: string;
  name: string;
  displayName: string;
  color: string;
  category: string;
}
interface Props {
  providers: OrbitProvider[];
  iconPaths?: Record<string, string | null>;
}
interface PlacedChip extends OrbitProvider {
  radius: number;
  baseAngle: number;
  ring: 0 | 1 | 2;
}

const RING_CONFIG = {
  0: { radius: 27, duration: 160, direction: 1 },
  1: { radius: 38, duration: 240, direction: -1 },
  2: { radius: 48, duration: 320, direction: 1 },
} as const;

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
    (a, b) => (HEADLINER_PRIORITY[b.name] ?? 0) - (HEADLINER_PRIORITY[a.name] ?? 0),
  );
  const rings: OrbitProvider[][] = [[], [], []];
  const caps = [6, 10, providers.length - 16];
  let ring = 0;
  for (const p of sorted) {
    while ((rings[ring]?.length ?? 0) >= (caps[ring] ?? 0)) ring++;
    rings[ring]?.push(p);
  }
  const placed: PlacedChip[] = [];
  for (let r = 0; r < 3; r++) {
    const count = rings[r]?.length;
    const offset = r * (Math.PI / count);
    for (let i = 0; i < count; i++) {
      const chip = rings[r]?.[i];
      if (!chip) continue;
      placed.push({
        ...chip,
        ring: r as 0 | 1 | 2,
        radius: RING_CONFIG[r as 0 | 1 | 2].radius,
        baseAngle: (i / count) * Math.PI * 2 + offset,
      });
    }
  }
  return placed;
}

const RECIPE_TAGS = ["b2b", "saas", "ai", "consumer", "mvp", "edge", "ssr", "internal"];
function slugifyRecipe(names: string[]): string {
  const head = names.slice(0, 3).join("-");
  const tag = RECIPE_TAGS[Math.floor(Math.random() * RECIPE_TAGS.length)]!;
  return `${head}-${tag}`;
}

/**
 * Read a ring's current visible rotation (radians) by parsing its computed
 * transform matrix. Works whether the ring is animating or just-paused: the
 * browser reports the frame it most recently painted, which is exactly what
 * we need to draw lines to the chips' on-screen positions.
 */
function readRingRotation(el: HTMLElement | null): number {
  if (!el) return 0;
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const m = t.match(/matrix\(([^)]+)\)/);
  if (!m) return 0;
  const parts = m[1]?.split(",").map((s) => Number.parseFloat(s.trim()));
  return Math.atan2(parts[1] ?? 0, parts[0] ?? 1);
}

export default function StackOrbit({ providers, iconPaths = {} }: Props) {
  const [reduced, setReduced] = useState(false);
  const [pulsing, setPulsing] = useState<Set<string>>(new Set());
  const [recipe, setRecipe] = useState<string[]>([]);
  const [recipeSlug, setRecipeSlug] = useState("");
  const [recipeActive, setRecipeActive] = useState(false);
  const [recipeFrozen, setRecipeFrozen] = useState(false);
  const [coreFlash, setCoreFlash] = useState(false);
  // SVG-coord line endpoints keyed by chip.name. `active` flips per pulse
  // stagger so each line draws/fades with its chip.
  const [lineTargets, setLineTargets] = useState<
    Record<string, { x: number; y: number; active: boolean }>
  >({});
  const pulseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ringRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const placed = useMemo(() => place(providers), [providers]);

  const clearTimers = useCallback(() => {
    for (const t of pulseTimers.current) clearTimeout(t);
    pulseTimers.current = [];
  }, []);

  /**
   * Fire one recipe: freeze rings, snapshot each ring's current rotation,
   * stagger-pulse 6 random chips while drawing lines from core → chip, then
   * unfreeze and schedule the next recipe in ~15s.
   */
  const fireRecipe = useCallback(
    (opts?: { fromClick?: boolean }) => {
      if (reduced) return;
      clearTimers();

      const pool = [...placed].sort(() => Math.random() - 0.5).slice(0, 6);
      const names = pool.map((p) => p.name);
      setRecipeFrozen(true);
      setRecipeActive(true);
      setRecipe(names);
      setRecipeSlug(slugifyRecipe(names));
      if (opts?.fromClick) {
        setCoreFlash(true);
        pulseTimers.current.push(setTimeout(() => setCoreFlash(false), 600));
      }

      // rAF so the paused rings have committed their stable matrix before we
      // measure — otherwise we'd read pre-freeze rotation and the lines would
      // miss the chips by a few degrees.
      requestAnimationFrame(() => {
        const rot: [number, number, number] = [
          readRingRotation(ringRefs.current[0]),
          readRingRotation(ringRefs.current[1]),
          readRingRotation(ringRefs.current[2]),
        ];
        const targets: Record<string, { x: number; y: number; active: boolean }> = {};
        for (const p of pool) {
          const a = p.baseAngle + rot[p.ring];
          targets[p.name] = { x: p.radius * Math.cos(a), y: p.radius * Math.sin(a), active: false };
        }
        setLineTargets(targets);

        for (let i = 0; i < pool.length; i++) {
          const target = pool[i]?.name;
          pulseTimers.current.push(
            setTimeout(() => {
              setPulsing((prev) => new Set(prev).add(target));
              setLineTargets((prev) =>
                prev[target] ? { ...prev, [target]: { ...prev[target]!, active: true } } : prev,
              );
            }, i * 220),
            setTimeout(
              () => {
                setPulsing((prev) => {
                  const next = new Set(prev);
                  next.delete(target);
                  return next;
                });
                setLineTargets((prev) =>
                  prev[target] ? { ...prev, [target]: { ...prev[target]!, active: false } } : prev,
                );
              },
              i * 220 + 900,
            ),
          );
        }

        const totalMs = pool.length * 220 + 900;
        pulseTimers.current.push(
          setTimeout(() => {
            setRecipeFrozen(false);
            setLineTargets({});
            setRecipeActive(false);
          }, totalMs + 1000),
          setTimeout(() => fireRecipe(), totalMs + 15000),
        );
      });
    },
    [placed, reduced, clearTimers],
  );

  useEffect(() => {
    if (reduced) return;
    pulseTimers.current.push(setTimeout(() => fireRecipe(), 4500));
    return () => clearTimers();
  }, [fireRecipe, reduced, clearTimers]);

  // Entrance cascade wraps up at ~1400ms; flash the core to punctuate arrival.
  // Capture BOTH timers so cleanup-on-unmount can't leak a state update.
  useEffect(() => {
    if (reduced) return;
    let inner: ReturnType<typeof setTimeout> | undefined;
    const outer = setTimeout(() => {
      setCoreFlash(true);
      inner = setTimeout(() => setCoreFlash(false), 700);
    }, 1400);
    return () => {
      clearTimeout(outer);
      if (inner) clearTimeout(inner);
    };
  }, [reduced]);

  const onCoreActivate = useCallback(() => {
    if (!reduced) fireRecipe({ fromClick: true });
  }, [fireRecipe, reduced]);
  const onCoreKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (reduced) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fireRecipe({ fromClick: true });
      }
    },
    [fireRecipe, reduced],
  );

  return (
    <div
      className={[
        "stack-orbit relative w-full h-full",
        reduced ? "" : "orbit-cascade",
        recipeFrozen ? "orbit-frozen" : "",
        coreFlash ? "orbit-core-flash" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Orbital visualization of the 29 providers Stack integrates"
    >
      {!reduced && (
        <div
          className={`orbit-recipe-label absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none mono text-[10px] px-2 py-1 tracking-[0.08em] ${recipeActive ? "is-visible" : ""}`}
          aria-hidden="true"
        >
          <span className="text-[color:var(--color-blade-400)]">▶</span>{" "}
          <span className="text-[color:var(--color-ink-400)]">stack apply</span>{" "}
          <span className="text-[color:var(--color-blade-300)]">{recipeSlug || "…"}</span>
        </div>
      )}

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
        <circle cx="0" cy="0" r="22" fill="url(#orbit-core-glow)" />
        <circle
          cx="0"
          cy="0"
          r={RING_CONFIG[0].radius}
          fill="none"
          stroke="rgba(245,136,62,0.10)"
          strokeWidth="0.3"
          strokeDasharray="1 1.5"
        />
        <circle
          cx="0"
          cy="0"
          r={RING_CONFIG[1].radius}
          fill="none"
          stroke="rgba(245,136,62,0.08)"
          strokeWidth="0.3"
          strokeDasharray="1 2"
        />
        <circle
          cx="0"
          cy="0"
          r={RING_CONFIG[2].radius}
          fill="none"
          stroke="rgba(245,136,62,0.06)"
          strokeWidth="0.3"
          strokeDasharray="1 2.5"
        />

        {/* Recipe lines — stroke-dashoffset paints each line from core
            outward when `active` flips true during the pulse stagger. */}
        {!reduced &&
          Object.entries(lineTargets).map(([name, t]) => {
            const len = Math.hypot(t.x, t.y);
            return (
              <line
                key={`line-${name}`}
                x1="0"
                y1="0"
                x2={t.x}
                y2={t.y}
                stroke="#f5883e"
                strokeWidth={0.5}
                strokeLinecap="round"
                opacity={t.active ? 0.75 : 0}
                style={{
                  strokeDasharray: `${len} ${len}`,
                  strokeDashoffset: t.active ? 0 : len,
                  transition:
                    "stroke-dashoffset 420ms cubic-bezier(0.2, 0.9, 0.3, 1), opacity 280ms ease",
                }}
              />
            );
          })}

        <g
          className="orbit-core-group"
          role="button"
          tabIndex={reduced ? -1 : 0}
          aria-label="Fire a new stack apply recipe"
          onClick={onCoreActivate}
          onKeyDown={onCoreKey}
          style={{ pointerEvents: "auto", cursor: reduced ? "default" : "pointer" }}
        >
          <circle cx="0" cy="0" r="16" fill="transparent" />
          <g className="orbit-core" filter="url(#orbit-core-blur)">
            <polygon
              points="0,-9 9,7 -9,7"
              fill="none"
              stroke="#e96b2a"
              strokeWidth="1.2"
              strokeLinejoin="miter"
            />
          </g>
          <polygon
            className="orbit-core-crisp"
            points="0,-9 9,7 -9,7"
            fill="none"
            stroke="#f5883e"
            strokeWidth="0.9"
            strokeLinejoin="miter"
          />
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
          {/* SVG-native focus ring — CSS `outline` on <g> is unreliable
               (Firefox ignores it, Chrome/Safari misalign under transform).
               This circle renders in SVG coord space so it survives the
               focus-state scale(1.15) correctly. */}
          <circle
            className="orbit-core-focus-ring"
            cx="0"
            cy="0"
            r="17"
            fill="none"
            stroke="#f5883e"
            strokeWidth="1"
            strokeDasharray="2 1.5"
          />
        </g>
      </svg>

      {[0, 1, 2].map((ringIdx) => {
        const cfg = RING_CONFIG[ringIdx as 0 | 1 | 2];
        const chips = placed.filter((c) => c.ring === ringIdx);
        return (
          <div
            key={ringIdx}
            ref={(el) => {
              ringRefs.current[ringIdx] = el;
            }}
            className={`orbit-ring ring-${ringIdx} absolute inset-0 pointer-events-none`}
            style={{
              animation: reduced
                ? "none"
                : `orbitSpin${cfg.direction > 0 ? "Fwd" : "Rev"} ${cfg.duration}s linear infinite`,
              animationPlayState: recipeFrozen ? "paused" : "running",
            }}
          >
            {chips.map((chip, chipIdx) => {
              const x = 50 + chip.radius * Math.cos(chip.baseAngle);
              const y = 50 + chip.radius * Math.sin(chip.baseAngle);
              const isPulsing = pulsing.has(chip.name);
              const inCurrentRecipe = recipe.includes(chip.name);
              // Outer (2) lands first at 0ms, middle (1) at ~350ms, inner (0)
              // at ~700ms; within each ring chips stagger by 40ms.
              const cascadeDelay = (2 - chip.ring) * 350 + chipIdx * 40;
              return (
                <a
                  key={chip.name}
                  href={`/providers/${chip.name}/`}
                  className={`orbit-chip pointer-events-auto absolute group ${isPulsing ? "pulsing" : ""} ${inCurrentRecipe ? "in-recipe" : ""}`}
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    animation: reduced
                      ? "none"
                      : `orbitSpin${cfg.direction > 0 ? "Rev" : "Fwd"} ${cfg.duration}s linear infinite`,
                    animationPlayState: recipeFrozen ? "paused" : "running",
                    transform: "translate(-50%, -50%)",
                    ["--cascade-delay" as string]: `${cascadeDelay}ms`,
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

      <div className="absolute left-3 bottom-3 caption text-[color:var(--color-steel-300)] pointer-events-none">
        29 PROVIDERS · 3 ORBITS
      </div>
      <div className="absolute right-3 bottom-3 caption text-[color:var(--color-blade-400)] mono text-[10px] pointer-events-none">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-[color:var(--color-blade-400)] mr-1.5"
          style={{ animation: reduced ? "none" : "orbitCorePulse 2.8s ease-in-out infinite" }}
        />
        live
      </div>

      <style>{`
        @keyframes orbitSpinFwd { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes orbitSpinRev { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
        @keyframes orbitCorePulse { 0%,100% { opacity: 0.45; transform: scale(1); } 50% { opacity: 1; transform: scale(1.15); } }
        @keyframes orbitCoreBreathe { 0%,100% { opacity: 0.7; } 50% { opacity: 1; } }
        .stack-orbit .orbit-core { animation: orbitCoreBreathe 3.6s ease-in-out infinite; transform-origin: center; }
        .stack-orbit .orbit-core-group {
          transform-origin: 0 0;
          transition: transform 220ms cubic-bezier(0.2, 0.9, 0.3, 1), filter 220ms ease;
          filter: drop-shadow(0 0 0 rgba(233, 107, 42, 0));
        }
        .stack-orbit .orbit-core-group:hover,
        .stack-orbit .orbit-core-group:focus-visible {
          transform: scale(1.15);
          filter: drop-shadow(0 0 3px rgba(233, 107, 42, 0.55));
        }
        .stack-orbit .orbit-core-focus-ring {
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms ease;
        }
        .stack-orbit .orbit-core-group:focus-visible .orbit-core-focus-ring { opacity: 1; }
        .stack-orbit .orbit-core-group:focus-visible .orbit-core-crisp { stroke: #fff; }
        .stack-orbit.orbit-core-flash .orbit-core-crisp { animation: coreFlash 600ms ease-out; }
        @keyframes coreFlash {
          0%   { stroke: #fff;    stroke-width: 1.6; filter: drop-shadow(0 0 4px rgba(245,136,62,0.9)); }
          100% { stroke: #f5883e; stroke-width: 0.9; filter: drop-shadow(0 0 0 rgba(245,136,62,0)); }
        }
        .stack-orbit .orbit-chip { transition: transform 220ms ease; will-change: transform; }
        .stack-orbit .orbit-chip:hover .chip-body,
        .stack-orbit .orbit-chip:focus-visible .chip-body {
          transform: scale(1.18);
          border-color: var(--color-blade-400);
          background: rgba(233, 107, 42, 0.14);
          box-shadow: 0 6px 24px -4px rgba(233, 107, 42, 0.4);
        }
        .stack-orbit .orbit-ring:hover { animation-play-state: paused; }
        .stack-orbit .orbit-ring:hover .orbit-chip { animation-play-state: paused; }
        .stack-orbit .orbit-chip.pulsing .chip-body { animation: chipPulse 900ms ease-out; }
        @keyframes chipPulse {
          0%   { transform: scale(1);    box-shadow: 0 0 0 0    rgba(233,107,42,0.6); border-color: var(--color-blade-500); }
          40%  { transform: scale(1.22); box-shadow: 0 0 0 14px rgba(233,107,42,0);   border-color: var(--color-blade-400); }
          100% { transform: scale(1);    box-shadow: 0 0 0 0    rgba(233,107,42,0);   border-color: var(--color-ink-700); }
        }
        /* Entrance cascade — runs once on first mount, outer ring → inner.
           Per-chip --cascade-delay is injected inline on the anchor. */
        .stack-orbit.orbit-cascade .chip-body {
          animation: chipCascade 680ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
          animation-delay: var(--cascade-delay, 0ms);
        }
        @keyframes chipCascade {
          0%   { opacity: 0; transform: scale(0.4) translateY(-10px); filter: blur(3px); }
          70%  { opacity: 1; transform: scale(1.08); filter: blur(0); }
          100% { opacity: 1; transform: scale(1); filter: blur(0); }
        }
        .stack-orbit.orbit-cascade .orbit-core-group {
          animation: coreReveal 900ms ease-out both;
          animation-delay: 900ms;
        }
        @keyframes coreReveal {
          0%   { opacity: 0; transform: scale(0.6); }
          100% { opacity: 1; transform: scale(1); }
        }
        .stack-orbit .orbit-recipe-label {
          opacity: 0;
          transform: translate(-50%, -4px);
          transition: opacity 260ms ease, transform 260ms cubic-bezier(0.2, 0.9, 0.3, 1);
          background: rgba(233, 107, 42, 0.10);
          border: 1px solid rgba(233, 107, 42, 0.28);
          border-radius: 2px;
          white-space: nowrap;
          backdrop-filter: blur(4px);
          z-index: 2;
        }
        .stack-orbit .orbit-recipe-label.is-visible { opacity: 1; transform: translate(-50%, 0); }
        @media (prefers-reduced-motion: reduce) {
          .stack-orbit .orbit-core,
          .stack-orbit .orbit-chip,
          .stack-orbit .orbit-ring,
          .stack-orbit .orbit-core-group,
          .stack-orbit .chip-body { animation: none !important; }
          .stack-orbit .orbit-recipe-label { display: none; }
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
        backgroundColor: isInRecipe ? "rgba(233, 107, 42, 0.06)" : "rgba(10, 12, 16, 0.82)",
        borderColor: isPulsing
          ? "var(--color-blade-400)"
          : isInRecipe
            ? "rgba(233, 107, 42, 0.35)"
            : "var(--color-ink-700)",
        transition:
          "transform 220ms ease, border-color 220ms ease, background 220ms ease, box-shadow 220ms ease",
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
          style={{ width: size * 0.5, height: size * 0.5, backgroundColor: `#${chip.color}` }}
        />
      )}
    </div>
  );
}
