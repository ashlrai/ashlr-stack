import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { useEffect, useRef } from "react";
import { installScrollChoreo } from "~/lib/motion/scroll";

/**
 * Global smooth-scroll + GSAP ScrollTrigger setup.
 *
 * Mounted once from <Base.astro> with `client:load`. In `prefers-reduced-motion`,
 * Lenis is a no-op and ScrollTrigger still runs (snap-on entrance, no scrub).
 */

export default function SmoothScroll() {
  const lenisRef = useRef<Lenis | null>(null);
  const tickerRef = useRef<((time: number) => void) | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    gsap.registerPlugin(ScrollTrigger);

    if (lenisRef.current) return;

    if (!reduced) {
      const lenis = new Lenis({
        duration: 1.1,
        easing: (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t)),
        smoothWheel: true,
        wheelMultiplier: 1,
        touchMultiplier: 1.2,
      });
      lenisRef.current = lenis;

      lenis.on("scroll", ScrollTrigger.update);
      const tick = (time: number) => lenis.raf(time * 1000);
      tickerRef.current = tick;
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    }

    installScrollChoreo();

    const t = setTimeout(() => ScrollTrigger.refresh(), 180);

    return () => {
      clearTimeout(t);
      if (tickerRef.current) {
        gsap.ticker.remove(tickerRef.current);
        tickerRef.current = null;
      }
      lenisRef.current?.destroy();
      lenisRef.current = null;
      for (const st of ScrollTrigger.getAll()) st.kill();
    };
  }, []);

  return null;
}
