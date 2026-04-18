import { Edges, Text } from "@react-three/drei";
import { forwardRef } from "react";
import type { Mesh } from "three";

/**
 * A single plate in the hero's 3D stack. Steel body with amber edge
 * highlights; labels + tier number etched onto the TOP face so the
 * isometric 3/4 camera reads them clearly. Accent plate (Phantom)
 * glows warm amber.
 */

interface Props {
  y: number;
  label: string;
  glyph: string;
  tier: number;
  width?: number;
  depth?: number;
  height?: number;
  accent?: boolean;
}

const BLADE_500 = "#e96b2a";
const BLADE_400 = "#f5883e";
const BLADE_300 = "#f9a877";
const STEEL_300 = "#6b8097";
const INK_100   = "#e1e5ea";
const INK_400   = "#6b7480";

const StackPlate = forwardRef<Mesh, Props>(function StackPlate(
  { y, label, glyph, tier, width = 4.2, depth = 3.0, height = 0.36, accent = false },
  ref,
) {
  const bodyColor         = accent ? "#3a2212" : "#242d38";
  const emissive          = accent ? BLADE_500 : "#1a2430";
  const emissiveIntensity = accent ? 0.7 : 0.22;
  const edgeColor         = accent ? BLADE_400 : STEEL_300;
  const labelColor        = accent ? BLADE_300 : INK_100;
  const tierColor         = accent ? BLADE_400 : STEEL_300;
  const glyphColor        = accent ? BLADE_300 : INK_400;
  const topY              = height / 2 + 0.0015;

  return (
    <group position={[0, y, 0]}>
      <mesh ref={ref} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={bodyColor}
          metalness={0.78}
          roughness={0.34}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
        />
        <Edges threshold={1} color={edgeColor} />
      </mesh>

      {/* Glyph — left side of top face */}
      <Text
        position={[-width / 2 + 0.38, topY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.26}
        anchorX="left"
        anchorY="middle"
        color={glyphColor}
      >
        {glyph}
      </Text>

      {/* Tier label — etched on top face */}
      <Text
        position={[-width / 2 + 0.82, topY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.22}
        anchorX="left"
        anchorY="middle"
        color={labelColor}
        letterSpacing={0.14}
        outlineWidth={0.002}
        outlineColor={accent ? "#3b1a0b" : "#050710"}
      >
        {label}
      </Text>

      {/* Tier number — right side of top face */}
      <Text
        position={[width / 2 - 0.34, topY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.24}
        anchorX="right"
        anchorY="middle"
        color={tierColor}
        letterSpacing={0.08}
      >
        {String(tier).padStart(2, "0")}
      </Text>

      {/* Amber foot-light under the Phantom plate only — grounds the stack */}
      {accent && (
        <mesh position={[0, -height / 2 - 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[width * 1.04, depth * 1.04]} />
          <meshBasicMaterial color={BLADE_400} transparent opacity={0.22} />
        </mesh>
      )}
    </group>
  );
});

export default StackPlate;
