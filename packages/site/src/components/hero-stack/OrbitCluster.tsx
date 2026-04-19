import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

/**
 * OrbitCluster — renders a constellation of provider "satellites" orbiting
 * the selected tier's plate at its Y height. Each provider is a glowing
 * brand-colored sphere with a billboarded text label. The whole cluster
 * rotates slowly around the plate's Y-axis so the scene feels alive.
 *
 * Sits inside the StackRig group so OrbitControls + rig-level transforms
 * apply cleanly.
 */

interface OrbitProvider {
  name: string;
  color: string;   // hex w/o # (from PROVIDERS[].color)
}

interface Props {
  y: number;
  providers: OrbitProvider[];
  radius?: number;
  speed?: number;
}

export default function OrbitCluster({ y, providers, radius = 3.2, speed = 0.12 }: Props) {
  const groupRef = useRef<Group>(null);

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += dt * speed;
  });

  if (providers.length === 0) return null;

  const step = (2 * Math.PI) / providers.length;

  return (
    <group ref={groupRef} position={[0, y, 0]}>
      {/* Orbit ring — thin amber hoop at the satellite radius */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.01, radius + 0.01, 72]} />
        <meshBasicMaterial color="#f5883e" transparent opacity={0.25} />
      </mesh>

      {providers.map((p, i) => {
        const theta = i * step;
        const x = Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius;
        const brand = `#${p.color}`;
        return (
          <group key={p.name} position={[x, 0, z]}>
            {/* Glowing sphere, brand-colored */}
            <mesh>
              <sphereGeometry args={[0.18, 20, 20]} />
              <meshStandardMaterial
                color={brand}
                emissive={brand}
                emissiveIntensity={0.9}
                roughness={0.3}
                metalness={0.1}
              />
            </mesh>
            {/* Halo */}
            <mesh>
              <sphereGeometry args={[0.28, 16, 16]} />
              <meshBasicMaterial color={brand} transparent opacity={0.12} />
            </mesh>
            {/* Label — always faces the camera */}
            <Billboard position={[0, 0.45, 0]}>
              <Text
                fontSize={0.18}
                anchorX="center"
                anchorY="middle"
                color="#e1e5ea"
                outlineWidth={0.01}
                outlineColor="#050710"
                letterSpacing={0.06}
              >
                {p.name.toUpperCase()}
              </Text>
            </Billboard>
            {/* Radial connector back to the plate center */}
            <mesh position={[-x / 2, 0, -z / 2]} rotation={[0, -theta, 0]}>
              <boxGeometry args={[radius - 0.2, 0.015, 0.015]} />
              <meshBasicMaterial color="#f5883e" transparent opacity={0.3} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
