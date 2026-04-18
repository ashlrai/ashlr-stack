import { useEffect } from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { installScrollChoreo } from "~/lib/motion/scroll";

/**
 * Global smooth-scroll + GSAP ScrollTrigger setup.
 *
 * Mounted once from <Base.astro> with `client:load`. In `prefers-reduced-motion`,
 * Lenis is a no-op and ScrollTrigger still runs (snap-on entrance, no scrub).
 */

let lenisInstance: Lenis | null = null;

export default function SmoothScroll() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    gsap.registerPlugin(ScrollTrigger);

    // idempotent install guard — HMR + Astro client:load rehydration
    if (lenisInstance) return;

    if (!reduced) {
      lenisInstance = new Lenis({
        duration: 1.1,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 1,
        touchMultiplier: 1.2,
      });

      lenisInstance.on("scroll", ScrollTrigger.update);
      gsap.ticker.add((time) => lenisInstance?.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    }

    installScrollChoreo();

    // Give GSAP a tick to see the DOM, then refresh — catches late image loads etc.
    const t = setTimeout(() => ScrollTrigger.refresh(), 180);

    return () => {
      clearTimeout(t);
      lenisInstance?.destroy();
      lenisInstance = null;
      ScrollTrigger.getAll().forEach((st) => st.kill());
    };
  }, []);

  return null;
}
