import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group } from "three";
import StackPlate from "./StackPlate";

/**
 * Eight-plate stack. Viewed from an isometric 3/4 camera defined in
 * HeroStack3D — the rig itself sits axis-aligned and only receives a
 * gentle idle drift + damped cursor-follow tilt. On first mount, plates
 * drop from above into their rest position.
 */

const TIERS = [
  { label: "HUMAN / AGENT", accent: false, glyph: "◇" },
  { label: "CLI / MCP",     accent: false, glyph: "⊞" },
  { label: "AI APIS",       accent: false, glyph: "∴" },
  { label: "OBSERVABILITY", accent: false, glyph: "◉" },
  { label: "DEPLOY",        accent: false, glyph: "▲" },
  { label: "DATABASES",     accent: false, glyph: "▦" },
  { label: "AUTH",          accent: false, glyph: "⊕" },
  { label: "PHANTOM",       accent: true,  glyph: "◈" },
];

const PLATE_GAP    = 0.36;
const PLATE_HEIGHT = 0.30;
const LAYER_H      = PLATE_HEIGHT + PLATE_GAP;

const MAX_ROT_Y = 0.18;
const MAX_ROT_X = 0.08;

export default function StackRig({ reduced = false }: { reduced?: boolean }) {
  const group = useRef<Group>(null);
  const target = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const assembledAt = useRef<number>(0);

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

  useFrame((_, dt) => {
    if (!group.current) return;
    const now = performance.now();
    if (!assembledAt.current) assembledAt.current = now;
    const elapsed = now - assembledAt.current;

    group.current.children.forEach((child, i) => {
      const stagger = i * 55;
      const totalMs = reduced ? 0 : 220 + stagger;
      const t = Math.max(0, Math.min(1, (elapsed - stagger) / (totalMs || 1)));
      const eased = 1 - Math.pow(1 - t, 3);
      const restY = (3.5 - i) * LAYER_H;
      const startY = restY + 3.4;
      child.position.y = reduced ? restY : startY + (restY - startY) * eased;
      child.visible = true;
    });

    // idle sway + cursor offset (camera handles the iso 3/4 view)
    const drift = reduced ? 0 : Math.sin(now * 0.00022) * 0.12;
    const wantY = drift + target.current.x * MAX_ROT_Y;
    const wantX = reduced ? 0 : target.current.y * MAX_ROT_X * -1;
    const k = 1 - Math.pow(1 - 0.08, dt * 60);
    group.current.rotation.y += (wantY - group.current.rotation.y) * k;
    group.current.rotation.x += (wantX - group.current.rotation.x) * k;

    const breathe = Math.sin(now * 0.0009) * 0.02;
    group.current.position.y = breathe;
  });

  return (
    <group ref={group}>
      {TIERS.map((tier, i) => (
        <StackPlate
          key={tier.label}
          y={(3.5 - i) * LAYER_H}
          label={tier.label}
          glyph={tier.glyph}
          tier={TIERS.length - i}
          accent={tier.accent}
        />
      ))}
    </group>
  );
}
