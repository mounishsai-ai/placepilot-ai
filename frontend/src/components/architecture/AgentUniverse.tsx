"use client";
import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Billboard, Text, Line, Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";
import { NODES, EDGES, NODE_MAP, type AgentNode } from "./agentData";

/* A deterministic 3D node graph, not a physics simulation -- every position
   comes straight from agentData.ts. The 2D version of this diagram (built
   earlier tonight) broke because hand-guessed percentage coordinates never
   matched the real rendered layout; fixed 3D coordinates plus drei's tested
   primitives (Line, Billboard, OrbitControls) avoid that failure mode
   entirely -- nothing here is computed from DOM measurement or a solver. */

function Starfield() {
  const positions = useMemo(() => {
    const pts = new Float32Array(1400 * 3);
    for (let i = 0; i < 1400; i++) {
      const r = 30 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pts[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pts[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pts[i * 3 + 2] = r * Math.cos(phi);
    }
    return pts;
  }, []);
  return (
    <Points positions={positions} stride={3}>
      <PointMaterial color="#8fae9e" size={0.05} sizeAttenuation transparent opacity={0.55} depthWrite={false} />
    </Points>
  );
}

function GlowNode({
  node,
  active,
  onHover,
  onLeave,
  onSelect,
}: {
  node: AgentNode;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
  onSelect: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const t0 = useRef(Math.random() * Math.PI * 2);

  useFrame((state) => {
    const t = state.clock.elapsedTime + t0.current;
    const pulse = 1 + Math.sin(t * 1.4) * 0.06;
    const scale = (active ? 1.35 : 1) * pulse;
    if (meshRef.current) meshRef.current.scale.setScalar(scale);
    if (glowRef.current) glowRef.current.scale.setScalar(scale * (active ? 2.6 : 2.1));
  });

  return (
    <group position={node.position}>
      <mesh ref={glowRef}>
        <sphereGeometry args={[node.radius, 16, 16]} />
        <meshBasicMaterial color={node.color} transparent opacity={active ? 0.22 : 0.13} depthWrite={false} />
      </mesh>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); onHover(); document.body.style.cursor = "pointer"; }}
        onPointerOut={(e) => { e.stopPropagation(); onLeave(); document.body.style.cursor = "auto"; }}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <sphereGeometry args={[node.radius, 32, 32]} />
        <meshStandardMaterial
          color={node.color}
          emissive={node.color}
          emissiveIntensity={active ? 1.4 : 0.75}
          roughness={0.35}
          metalness={0.1}
        />
      </mesh>
      <Billboard position={[0, node.radius + 0.42, 0]}>
        <Text fontSize={node.kind === "core" ? 0.34 : 0.26} color="#F5F6EF" anchorX="center" anchorY="bottom" outlineWidth={0.012} outlineColor="#0B1714">
          {node.label}
        </Text>
      </Billboard>
    </group>
  );
}

function EdgeLine({ from, to, color }: { from: [number, number, number]; to: [number, number, number]; color: string }) {
  return <Line points={[from, to]} color={color} lineWidth={1.4} transparent opacity={0.65} />;
}

function Rig() {
  useFrame((state) => {
    state.camera.lookAt(0, 0.3, 0);
  });
  return null;
}

export default function AgentUniverse({
  onSelect,
  selectedId,
}: {
  onSelect: (id: string | null) => void;
  selectedId: string | null;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <Canvas
      camera={{ position: [10, 6, 13], fov: 48 }}
      gl={{ antialias: true }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={["#050a08"]} />
      <fog attach="fog" args={["#050a08", 18, 42]} />
      <ambientLight intensity={0.55} />
      <pointLight position={[8, 10, 8]} intensity={60} color="#ffffff" />
      <pointLight position={[-8, -6, -8]} intensity={30} color="#0FA968" />

      <Starfield />
      <Rig />

      {EDGES.map((e, i) => (
        <EdgeLine key={i} from={NODE_MAP[e.from].position} to={NODE_MAP[e.to].position} color={e.color} />
      ))}

      {NODES.map((n) => (
        <GlowNode
          key={n.id}
          node={n}
          active={hoveredId === n.id || selectedId === n.id}
          onHover={() => setHoveredId(n.id)}
          onLeave={() => setHoveredId((h) => (h === n.id ? null : h))}
          onSelect={() => onSelect(n.id)}
        />
      ))}

      <OrbitControls
        enablePan={false}
        minDistance={7}
        maxDistance={30}
        autoRotate
        autoRotateSpeed={0.45}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}
