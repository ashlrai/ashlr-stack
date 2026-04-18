import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group } from "three";
import StackPlate from "./StackPlate";

/**
 * Eight-plate stack. Responds to cursor position with damped tilt + rotation.
 * On first mount, plates drop from above into their rest position (GSAP-less —
 * done via a simple elapsed-time spring so this island stays tiny).
 *
 * Rest pose: -7° Y rotation, 0° X tilt.
 * Cursor influence: max ±10° on Y, max ±6° on X. Damped lerp.
 */

const TIERS = [
  { label: "HUMAN / AGENT", accent: false },
  { label: "CLI / MCP",     accent: false },
  { label: "AI APIS",       accent: false },
  { label: "OBSERVABILITY", accent: false },
  { label: "DEPLOY",        accent: false },
  { label: "DATABASES",     accent: false },
  { label: "AUTH",          accent: false },
  { label: "PHANTOM",       accent: true  }, // bottom foundation plate glows
];

const PLATE_GAP    = 0.12;
const PLATE_HEIGHT = 0.28;
const LAYER_H     = PLATE_HEIGHT + PLATE_GAP;

const REST_ROT_Y = -Math.PI / 26; // ≈ -7°
const MAX_ROT_Y  = Math.PI / 18;  // ±10°
const MAX_ROT_X  = Math.PI / 30;  // ±6°

export default function StackRig({ reduced = false }: { reduced?: boolean }) {
  const group = useRef<Group>(null);
  const target = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const assembledAt = useRef<number>(0);

  // Normalize mouse to -1..1 on both axes; update target on move.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (reduced) return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      target.current.x = nx;
      target.current.y = ny;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced]);

  // Assemble drop-in: each plate falls from +2 above rest to rest over ~140ms,
  // staggered 45ms per plate. After assemble completes, hand over to idle sway.
  useFrame((_, dt) => {
    if (!group.current) return;
    const now = performance.now();
    if (!assembledAt.current) assembledAt.current = now;
    const elapsed = now - assembledAt.current;

    // Children 0..7 of the group are plates top → bottom
    group.current.children.forEach((child: import("three").Object3D, i: number) => {
      const stagger = i * 45;                     // top plate lands first
      const totalMs = reduced ? 0 : 160 + stagger;
      const t       = Math.max(0, Math.min(1, (elapsed - stagger) / (totalMs || 1)));
      const eased   = 1 - Math.pow(1 - t, 3);
      const restY   = (3.5 - i) * LAYER_H;
      const startY  = restY + 2;
      child.position.y = reduced ? restY : startY + (restY - startY) * eased;
      child.visible = true;
    });

    // Rig-level tilt — lerp current rotation toward target pose.
    const wantY = reduced ? REST_ROT_Y : REST_ROT_Y + target.current.x * MAX_ROT_Y;
    const wantX = reduced ? 0            : target.current.y * MAX_ROT_X * -1;
    const k = 1 - Math.pow(1 - 0.08, dt * 60);   // frame-rate independent damping
    group.current.rotation.y += (wantY - group.current.rotation.y) * k;
    group.current.rotation.x += (wantX - group.current.rotation.x) * k;

    // idle breathing — gentle +/- 0.015 on Y position
    const breathe = Math.sin(now * 0.0009) * 0.015;
    group.current.position.y = breathe;
  });

  return (
    <group ref={group} rotation={[0, REST_ROT_Y, 0]}>
      {TIERS.map((tier, i) => (
        <StackPlate
          key={tier.label}
          y={(3.5 - i) * LAYER_H}
          label={tier.label}
          tier={TIERS.length - i}
          accent={tier.accent}
        />
      ))}
    </group>
  );
}
