import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useState } from "react";
import StackRig from "./hero-stack/StackRig";

/**
 * Locks the camera onto the stack origin every frame. R3F's default camera
 * faces straight down -Z regardless of the position prop, so without a
 * continuous lookAt the plates project edge-on as thin horizontal bands.
 * useFrame keeps it locked even if the camera object is ever re-created.
 */
function CameraTarget() {
  useFrame(({ camera }) => {
    camera.lookAt(0, 0.2, 0);
  });
  return null;
}

/**
 * Hero 3D scene — eight-plate stack representing Stack's tier architecture.
 *
 * Hydrated with `client:visible` from the Astro side. Since the canvas lives
 * above the fold the IntersectionObserver fires almost immediately, but this
 * still defers the three/R3F bundle parse until the browser is idle enough
 * to observe it — leaving TTI unblocked.
 *
 * No shadows, no HDR env map, no post-processing — industrial aesthetic is
 * carried by the geometry + amber edge emission, not by WebGL pyrotechnics.
 */

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

  return (
    <Canvas
      camera={{ position: [3.6, 2.8, 5.4], fov: 42, near: 0.1, far: 60 }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%", background: "transparent" }}
    >
      <CameraTarget />
      <fog attach="fog" args={["#05070a", 8, 18]} />

      {/* base ambient so plates never read as pure black */}
      <ambientLight intensity={0.28} />

      {/* key amber rim from upper-right — the signature Anduril warmth */}
      <directionalLight position={[6, 7, 3]} intensity={1.7} color="#f5883e" />

      {/* cool steel fill from upper-left */}
      <directionalLight position={[-5.5, 5.5, 4]} intensity={0.7} color="#6b8097" />

      {/* Phantom underglow — warm pool under the bottom plate */}
      <pointLight position={[0, -3.2, 1.5]} intensity={1.3} color="#e96b2a" distance={8} />

      {/* subtle back rim to kiss the rear edges of the plates */}
      <directionalLight position={[0, 2, -5]} intensity={0.4} color="#c4ccd5" />

      <StackRig reduced={reduced} />
    </Canvas>
  );
}
