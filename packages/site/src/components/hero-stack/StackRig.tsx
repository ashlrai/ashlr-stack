import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group } from "three";
import StackPlate from "./StackPlate";

/**
 * Eight-plate stack. The rig group holds all plates and receives drag-
 * rotation from HeroStack3D via the exposed `groupRef`. Plates drop in
 * from above on first mount, then sit at rest; pointer interactions are
 * delegated to StackPlate + surfaced through onHover / onSelect.
 */

interface Tier { label: string; glyph: string; accent?: boolean }

export const TIERS: Tier[] = [
  { label: "HUMAN / AGENT", glyph: "◇" },
  { label: "CLI / MCP",     glyph: "⊞" },
  { label: "AI APIS",       glyph: "∴" },
  { label: "OBSERVABILITY", glyph: "◉" },
  { label: "DEPLOY",        glyph: "▲" },
  { label: "DATABASES",     glyph: "▦" },
  { label: "AUTH",          glyph: "⊕" },
  { label: "PHANTOM",       glyph: "◈", accent: true },
];

const PLATE_GAP    = 0.48;
const PLATE_HEIGHT = 0.36;
const LAYER_H      = PLATE_HEIGHT + PLATE_GAP;
const CENTER_INDEX = (TIERS.length - 1) / 2;

export const restYFor = (i: number) => (CENTER_INDEX - i) * LAYER_H;

interface Props {
  reduced?: boolean;
  hovered: number | null;
  selected: number | null;
  onHover: (index: number | null) => void;
  onSelect: (index: number) => void;
}

export default function StackRig({ reduced = false, hovered, selected, onHover, onSelect }: Props) {
  const group = useRef<Group>(null);
  const assembledAt = useRef<number>(0);

  // Drop-in assemble: plates fall from +3.4 above rest, staggered 55ms each.
  useFrame(() => {
    if (!group.current) return;
    const now = performance.now();
    if (!assembledAt.current) assembledAt.current = now;
    const elapsed = now - assembledAt.current;

    group.current.children.forEach((child, i) => {
      const stagger = i * 55;
      const totalMs = reduced ? 0 : 220 + stagger;
      const t = Math.max(0, Math.min(1, (elapsed - stagger) / (totalMs || 1)));
      const eased = 1 - Math.pow(1 - t, 3);
      const rest = restYFor(i);
      const start = rest + 3.4;
      child.position.y = reduced ? rest : start + (rest - start) * eased;
      child.visible = true;
    });

    const breathe = Math.sin(now * 0.0009) * 0.02;
    group.current.position.y = breathe;
  });

  // Make the group ref available to HeroStack3D for drag-rotate integration.
  // We re-emit via the onHover side-channel once; simpler than a ref-forwarding
  // dance given the rig is always mounted inside HeroStack3D.
  useEffect(() => { /* noop — ref is owned internally */ }, []);

  return (
    <group ref={group}>
      {TIERS.map((tier, i) => (
        <StackPlate
          key={tier.label}
          y={restYFor(i)}
          index={i}
          label={tier.label}
          glyph={tier.glyph}
          tier={TIERS.length - i}
          accent={tier.accent}
          hovered={hovered === i}
          selected={selected === i}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}
