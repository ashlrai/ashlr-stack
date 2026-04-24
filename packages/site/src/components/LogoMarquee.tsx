import { useEffect, useMemo, useState } from "react";

/**
 * LogoMarquee — dual-row continuous-scroll wall of every provider we wire.
 *
 * Answers "what does Stack actually integrate?" in one glance, without the
 * user scrolling or clicking. Two rows scroll in opposite directions at
 * slightly different speeds so the eye keeps finding new logos.
 *
 * - Data: all entries in `packages/core/src/catalog.ts` (29 as of v0.1.1),
 *   threaded in via `iconPaths` from Hero.astro (same simple-icons pipeline
 *   the rest of the site uses).
 * - Hover: pauses the row the mouse is over + pops the hovered chip +
 *   reveals `stack add <name>`.
 * - Click: navigates to /providers/<slug> (the programmatic SEO pages).
 * - Reduced motion: static grid, no animation.
 */

interface MarqueeProvider {
  slug: string; // simple-icons slug (matches iconPaths key)
  name: string; // CLI name (matches /providers/[slug] route)
  displayName: string;
  color: string; // hex without #
}

interface Props {
  providers: MarqueeProvider[];
  iconPaths?: Record<string, string | null>;
}

export default function LogoMarquee({ providers, iconPaths = {} }: Props) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Split roughly in half — top row scrolls left, bottom row scrolls right.
  const [rowA, rowB] = useMemo(() => {
    const half = Math.ceil(providers.length / 2);
    return [providers.slice(0, half), providers.slice(half)];
  }, [providers]);

  if (reduced) {
    return (
      <section
        aria-label="Supported providers"
        className="py-16 px-6 border-y border-[color:var(--color-ink-700)]"
      >
        <div className="mx-auto max-w-[1240px]">
          <div className="eyebrow mb-6 text-[color:var(--color-blade-400)]">
            {providers.length} providers · 11 categories · all wired the same way
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-3">
            {providers.map((p) => (
              <LogoChip key={p.slug} provider={p} iconPaths={iconPaths} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Supported providers"
      className="logo-marquee relative py-12 border-y border-[color:var(--color-ink-700)] overflow-hidden"
    >
      {/* Edge fades */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-24 z-10"
        style={{
          background: "linear-gradient(to right, var(--color-ink-900), transparent)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-24 z-10"
        style={{
          background: "linear-gradient(to left, var(--color-ink-900), transparent)",
        }}
      />

      <div className="mx-auto max-w-[1240px] px-6 mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow text-[color:var(--color-blade-400)]">Supported providers</div>
          <div className="text-[14px] text-[color:var(--color-ink-200)] mt-1">
            <span className="text-[color:var(--color-ink-50)] font-semibold">
              {providers.length} providers
            </span>
            , wired the same way.{" "}
            <span className="text-[color:var(--color-ink-400)]">
              Click any logo to see what{" "}
              <code className="mono text-[color:var(--color-ink-100)]">stack add</code> does for it.
            </span>
          </div>
        </div>
        <a
          href="/docs/providers/"
          className="mono text-[11px] tracking-[0.12em] uppercase text-[color:var(--color-ink-400)] hover:text-[color:var(--color-blade-400)] transition-colors whitespace-nowrap"
        >
          Full catalog →
        </a>
      </div>

      <Row direction="left" providers={rowA} iconPaths={iconPaths} durationSec={52} />
      <div className="h-3" />
      <Row direction="right" providers={rowB} iconPaths={iconPaths} durationSec={64} />

      <style>{`
        .logo-marquee .marquee-track {
          display: flex;
          gap: 0.75rem;
          width: max-content;
          will-change: transform;
        }
        .logo-marquee .marquee-track.left {
          animation: marqueeLeft var(--dur, 52s) linear infinite;
        }
        .logo-marquee .marquee-track.right {
          animation: marqueeRight var(--dur, 64s) linear infinite;
        }
        .logo-marquee .marquee-row:hover .marquee-track {
          animation-play-state: paused;
        }
        @keyframes marqueeLeft {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes marqueeRight {
          from { transform: translateX(-50%); }
          to   { transform: translateX(0); }
        }
        .logo-marquee .logo-chip {
          transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
        }
        .logo-marquee .logo-chip:hover,
        .logo-marquee .logo-chip:focus-visible {
          transform: translateY(-2px) scale(1.04);
          border-color: var(--color-blade-400);
          background: rgba(233, 107, 42, 0.08);
        }
      `}</style>
    </section>
  );
}

function Row({
  direction,
  providers,
  iconPaths,
  durationSec,
}: {
  direction: "left" | "right";
  providers: MarqueeProvider[];
  iconPaths: Record<string, string | null>;
  durationSec: number;
}) {
  // Duplicate once so the animation can loop seamlessly by translating -50%.
  const doubled = [...providers, ...providers];
  return (
    <div className="marquee-row overflow-hidden">
      <div
        className={`marquee-track ${direction}`}
        style={{ ["--dur" as string]: `${durationSec}s` }}
      >
        {doubled.map((p, i) => (
          <LogoChip key={`${p.slug}-${i}`} provider={p} iconPaths={iconPaths} />
        ))}
      </div>
    </div>
  );
}

function LogoChip({
  provider: p,
  iconPaths,
}: {
  provider: MarqueeProvider;
  iconPaths: Record<string, string | null>;
}) {
  const path = iconPaths[p.slug];
  return (
    <a
      href={`/providers/${p.name}/`}
      className="logo-chip inline-flex items-center gap-2 px-3 py-2 border border-[color:var(--color-ink-700)] bg-[color:var(--color-ink-900)]/80 rounded-md flex-shrink-0 min-w-fit"
      title={`stack add ${p.name}`}
      aria-label={`${p.displayName} — stack add ${p.name}`}
    >
      {path ? (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill={`#${p.color}`}
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path d={path} />
        </svg>
      ) : (
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: `#${p.color}` }}
        />
      )}
      <span className="mono text-[12px] text-[color:var(--color-ink-200)] whitespace-nowrap">
        {p.displayName}
      </span>
    </a>
  );
}
