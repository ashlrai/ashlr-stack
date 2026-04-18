import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";
import StackRig from "./hero-stack/StackRig";

/**
 * Hero 3D scene — eight-plate stack representing Stack's tier architecture.
 *
 * Lazy-hydrates below-the-fold (`client:visible` on the Astro side) so the
 * three/R3F bundle never blocks Time-to-Interactive on the hero.
 *
 * No shadows, no HDR env map, no post-processing — industrial aesthetic is
 * carried by the geometry + amber edge emission, not by WebGL pyrotechnics.
 */

export default function HeroStack3D() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 0.8, 7.4], fov: 38 }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%", background: "transparent" }}
    >
      {/* flat ambient so plates don't blow out */}
      <ambientLight intensity={0.18} />

      {/* warm rim light from upper-left — matches amber accent */}
      <directionalLight
        position={[-3.6, 5.2, 3.4]}
        intensity={1.1}
        color="#f5883e"
      />

      {/* cool fill from lower-right */}
      <directionalLight
        position={[4.2, -1.4, 2.2]}
        intensity={0.42}
        color="#6b8097"
      />

      {/* subtle ground-plane reflection from below */}
      <pointLight position={[0, -2.8, 2]} intensity={0.2} color="#e96b2a" />

      <StackRig reduced={reduced} />
    </Canvas>
  );
}
