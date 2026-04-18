import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Scroll-driven choreography — one function, called once from <SmoothScroll>.
 *
 * Every moment registers a ScrollTrigger that can be safely re-run on HMR.
 * Trigger invalidation happens on window resize via ScrollTrigger.refresh().
 */

let installed = false;

export function installScrollChoreo(): void {
  if (installed || typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    installed = true;
    return; // let CSS reveal states show instantly
  }

  gsap.registerPlugin(ScrollTrigger);
  installed = true;

  // ─── 1. Generic .reveal entries ────────────────────────────────────
  const reveals = document.querySelectorAll<HTMLElement>("[data-reveal]");
  reveals.forEach((el) => {
    gsap.fromTo(
      el,
      { autoAlpha: 0, y: 14 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.7,
        ease: "power3.out",
        scrollTrigger: {
          trigger: el,
          start: "top 88%",
          toggleActions: "play none none reverse",
        },
      },
    );
  });

  // ─── 2. Staggered children under .reveal-stagger ──────────────────
  const staggerParents = document.querySelectorAll<HTMLElement>("[data-reveal-stagger]");
  staggerParents.forEach((parent) => {
    const children = parent.querySelectorAll<HTMLElement>("[data-reveal-child]");
    if (!children.length) return;
    gsap.fromTo(
      children,
      { autoAlpha: 0, y: 10 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.6,
        ease: "power2.out",
        stagger: 0.025,
        scrollTrigger: {
          trigger: parent,
          start: "top 86%",
          toggleActions: "play none none reverse",
        },
      },
    );
  });

  // ─── 3. Hero plates spread as hero leaves viewport (subtle) ───────
  // Uses a CSS-var hook picked up by optional downstream effects.
  const hero = document.querySelector<HTMLElement>("#hero");
  if (hero) {
    gsap.to(hero, {
      "--hero-scroll": 1,
      ease: "none",
      scrollTrigger: {
        trigger: hero,
        start: "top top",
        end: "bottom top",
        scrub: true,
      },
    });
  }

  // ─── 4. SVG line-draw on anything with .draw-on-view ──────────────
  const lines = document.querySelectorAll<SVGPathElement | SVGLineElement>(".draw-on-view");
  const lineLength = (el: SVGPathElement | SVGLineElement): number => {
    if (el instanceof SVGLineElement) {
      const dx = el.x2.baseVal.value - el.x1.baseVal.value;
      const dy = el.y2.baseVal.value - el.y1.baseVal.value;
      return Math.hypot(dx, dy) || 400;
    }
    return el.getTotalLength();
  };
  lines.forEach((l) => {
    const len = lineLength(l);
    l.style.strokeDasharray = `${len}`;
    l.style.strokeDashoffset = `${len}`;
    gsap.to(l, {
      strokeDashoffset: 0,
      ease: "power2.inOut",
      duration: 1.2,
      scrollTrigger: {
        trigger: l,
        start: "top 82%",
        toggleActions: "play none none reverse",
      },
    });
  });

  // ─── 5. Refresh on resize (Lenis triggers this naturally too) ─────
  window.addEventListener("resize", () => ScrollTrigger.refresh(), { passive: true });
}
