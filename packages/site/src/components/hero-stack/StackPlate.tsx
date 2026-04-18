import { Edges, Text } from "@react-three/drei";
import { forwardRef } from "react";
import type { Mesh } from "three";

/**
 * A single steel plate in the hero's 3D stack. Brushed-metal look, 1px edge
 * highlight in amber via drei's <Edges>, etched label via drei's <Text>.
 *
 * Eight of these stack vertically inside <StackRig>.
 */

interface Props {
  y: number;                 // vertical position in rig-local units
  label: string;             // "COMPUTE" / "DATABASES" / etc.
  tier: number;              // 0–7, used by the caller for stagger + color
  width?: number;            // plate width
  depth?: number;            // plate depth
  height?: number;           // plate height
  accent?: boolean;          // bottom ("SECRETS / Phantom") plate gets warm glow
}

const BLADE_400 = "#f5883e";

const StackPlate = forwardRef<Mesh, Props>(function StackPlate(
  { y, label, tier, width = 6, depth = 4, height = 0.28, accent = false },
  ref,
) {
  const bodyColor = accent ? "#241912" : "#12151a";
  const emissive  = accent ? BLADE_400 : "#0b0e12";
  const emissiveIntensity = accent ? 0.45 : 0.08;

  return (
    <group position={[0, y, 0]}>
      <mesh ref={ref} castShadow={false} receiveShadow={false}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={bodyColor}
          metalness={0.72}
          roughness={0.38}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
        />
        <Edges
          threshold={1}
          color={accent ? BLADE_400 : "#3e4651"}
          linewidth={1}
        />
      </mesh>

      {/* Etched tier label — Berkeley Mono, small caps, centered on front face */}
      <Text
        position={[-width / 2 + 0.35, 0, depth / 2 + 0.002]}
        fontSize={0.13}
        anchorX="left"
        anchorY="middle"
        color={accent ? BLADE_400 : "#c4ccd5"}
        letterSpacing={0.18}
        maxWidth={width - 0.8}
      >
        {label}
      </Text>

      {/* Tier number — right side */}
      <Text
        position={[width / 2 - 0.35, 0, depth / 2 + 0.002]}
        fontSize={0.11}
        anchorX="right"
        anchorY="middle"
        color="#6b7480"
        letterSpacing={0.1}
      >
        {String(tier).padStart(2, "0")}
      </Text>

      {/* subtle inner highlight stripe along the top edge for depth */}
      <mesh position={[0, height / 2 + 0.001, 0]}>
        <planeGeometry args={[width * 0.98, depth * 0.98]} />
        <meshBasicMaterial
          color={accent ? BLADE_400 : "#2a3038"}
          transparent
          opacity={accent ? 0.35 : 0.25}
        />
      </mesh>

    </group>
  );
});

export default StackPlate;
