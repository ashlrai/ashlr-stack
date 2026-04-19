import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useState } from "react";
import StackRig, { TIERS, restYFor } from "./hero-stack/StackRig";
import OrbitCluster from "./hero-stack/OrbitCluster";
import { PROVIDERS, type Provider } from "~/lib/providers";

/**
 * Hero 3D scene — eight-plate stack representing Stack's tier architecture.
 *
 * Interactive:
 *  - Drag to rotate (OrbitControls, Y-axis only, zoom + pan disabled).
 *  - Auto-rotates gently at rest; drag + selection override; reduced-motion
 *    disables auto-rotate entirely.
 *  - Hover a plate → amber emissive glow + the overlay previews that tier.
 *  - Click a plate → pins the overlay; it reveals the real providers that
 *    live in that tier (filtered from PROVIDERS by category) with one-click
 *    anchors into the StackBuilder section below.
 *
 * Hydrated `client:visible` so the three/R3F bundle parses only when the
 * IntersectionObserver fires.
 */

interface TierContent {
  title: string;
  body: string;
  categories: Provider["category"][];
}

const TIER_CONTENT: TierContent[] = [
  {
    title: "Human / Agent",
    body: "You + your Claude Code session. Stack gives both one identical view of the stack — no copy-paste between tabs.",
    categories: [],
  },
  {
    title: "CLI + MCP",
    body: "The `stack` binary plus its MCP server. 22 commands for you, 17 tools for the agent, one source of truth.",
    categories: [],
  },
  {
    title: "AI APIs",
    body: "Language models, inference, evals. Every key verified against the upstream API on paste.",
    categories: ["AI"],
  },
  {
    title: "Observability",
    body: "Product analytics, error tracking, feature flags, LLM evals. MCP-wired where supported.",
    categories: ["Analytics", "Errors", "Features"],
  },
  {
    title: "Deploy",
    body: "Frontend platforms, serverless runtimes, edge providers, raw cloud. Scoped tokens stored in Phantom.",
    categories: ["Deploy", "Cloud"],
  },
  {
    title: "Databases",
    body: "Postgres, SQLite, KV, reactive backends. Provisioned via the provider's Management API when one exists.",
    categories: ["Database"],
  },
  {
    title: "Auth + Services",
    body: "User auth, source control, tickets, transactional email, payments. The long tail of per-project wiring.",
    categories: ["Auth", "Code", "Tickets", "Email", "Payments"],
  },
  {
    title: "Phantom",
    body: "E2E-encrypted vault — every secret VALUE lives here. Stack only holds the slot names.",
    categories: [],
  },
];

export default function HeroStack3D() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const activeIndex = selected ?? hovered;
  const activeContent = activeIndex != null ? TIER_CONTENT[activeIndex] : null;
  const activeProviders = activeContent
    ? PROVIDERS.filter((p) => activeContent.categories.includes(p.category))
    : [];

  return (
    <div className="relative w-full h-full">
      <Canvas
        camera={{ position: [7.2, 5.4, 10.2], fov: 36, near: 0.1, far: 80 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        style={{ width: "100%", height: "100%", background: "transparent" }}
      >
        <fog attach="fog" args={["#05070a", 14, 32]} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[6, 7, 3]} intensity={1.7} color="#f5883e" />
        <directionalLight position={[-5.5, 5.5, 4]} intensity={0.7} color="#6b8097" />
        <pointLight position={[0, -3.2, 1.5]} intensity={1.3} color="#e96b2a" distance={10} />
        <directionalLight position={[0, 2, -5]} intensity={0.4} color="#c4ccd5" />

        <StackRig
          reduced={reduced}
          hovered={hovered}
          selected={selected}
          onHover={setHovered}
          onSelect={(i) => setSelected((prev) => (prev === i ? null : i))}
        />

        {/* When a tier is clicked, its provider satellites orbit that plate. */}
        {selected !== null && activeProviders.length > 0 && (
          <OrbitCluster
            y={restYFor(selected)}
            providers={activeProviders.map((p) => ({ name: p.name, color: p.color }))}
          />
        )}

        <OrbitControls
          enableZoom
          zoomSpeed={0.5}
          minDistance={7}
          maxDistance={18}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={(Math.PI * 11) / 18}
          target={[0, 0.2, 0]}
          autoRotate={!reduced && selected === null && hovered === null}
          autoRotateSpeed={0.4}
        />
      </Canvas>

      {/* Overlay — tier detail when a plate is hovered or clicked. */}
      {activeContent && activeIndex != null && (
        <div
          role={selected !== null ? "dialog" : undefined}
          aria-live="polite"
          className="absolute left-3 right-3 bottom-3 panel-steel p-4 sm:p-5 z-10 pointer-events-auto"
          style={{
            borderLeft: "2px solid var(--color-blade-500)",
            backgroundColor: "rgba(10, 12, 16, 0.92)",
            backdropFilter: "blur(10px)",
            animation: "tierFadeIn 200ms ease-out",
          }}
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-blade-400)] mb-1">
                § · tier {String(TIERS.length - activeIndex).padStart(2, "0")}
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-[color:var(--color-ink-50)] tracking-tight">
                {activeContent.title}
              </h3>
            </div>
            {selected !== null && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-400)] hover:text-[color:var(--color-ink-100)]"
                aria-label="Close tier detail"
              >
                close ✕
              </button>
            )}
          </div>
          <p className="text-[12px] text-[color:var(--color-ink-300)] leading-[1.55] mb-3">
            {activeContent.body}
          </p>
          {activeProviders.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeProviders.map((p) => (
                <a
                  key={p.name}
                  href="#providers"
                  className="inline-flex items-center gap-1.5 mono text-[10px] tracking-[0.08em] px-2 py-1 border border-[color:var(--color-ink-600)] text-[color:var(--color-ink-200)] hover:border-[color:var(--color-blade-400)] hover:text-[color:var(--color-blade-400)] transition-colors"
                  title={`Jump to ${p.name} — ${p.blurb}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: `#${p.color}` }}
                  />
                  {p.name}
                </a>
              ))}
            </div>
          )}
          {selected === null && (
            <div className="mt-2 mono text-[9px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">
              click plate to pin · drag background to rotate
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes tierFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
