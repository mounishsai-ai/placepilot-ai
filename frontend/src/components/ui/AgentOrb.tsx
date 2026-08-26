"use client";
import { useEffect, useRef } from "react";

/* The agent's identity — not the product's logo.

   It appears wherever the agent is present: the activity panel it's writing
   into, the card where it's waiting on you. Nodes sit on a Fibonacci sphere
   (even spacing, no clustering at the poles), wired to their near neighbours,
   with a pulse travelling the node index — one pass per tool call. It turns
   gold in the one situation gold ever means anything here: the agent has
   stopped and needs a human. */

interface Props {
  size?: number;
  /** gold = the agent is waiting on a person; jade = working or idle */
  waiting?: boolean;
  /** frozen ring, no animation — for dense lists where motion would be noise */
  still?: boolean;
  className?: string;
}

export default function AgentOrb({ size = 26, waiting = false, still = false, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frozen = still || reduced;

    const N = 24;
    const R = size * 0.38;
    const LINK = 0.66;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const pts: { x: number; y: number; z: number }[] = [];
    const GA = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const th = i * GA;
      pts.push({ x: Math.cos(th) * rr, y, z: Math.sin(th) * rr });
    }

    const edges: [number, number][] = [];
    for (let a = 0; a < N; a++) {
      for (let b = a + 1; b < N; b++) {
        const dx = pts[a].x - pts[b].x;
        const dy = pts[a].y - pts[b].y;
        const dz = pts[a].z - pts[b].z;
        if (dx * dx + dy * dy + dz * dz < LINK * LINK) edges.push([a, b]);
      }
    }

    const cx = size / 2, cy = size / 2;
    const TILT = -0.42, ct = Math.cos(TILT), st = Math.sin(TILT);
    const NEAR = waiting ? "217,146,43" : "15,169,104";
    const FAR = waiting ? "240,190,107" : "52,216,154";

    let t = frozen ? 2400 : 0;
    let raf = 0;

    const project = (p: { x: number; y: number; z: number }, a: number) => {
      const ca = Math.cos(a), sa = Math.sin(a);
      const x = p.x * ca - p.z * sa;
      let z = p.x * sa + p.z * ca;
      const y = p.y * ct - z * st;
      z = p.y * st + z * ct;
      const k = 1 / (1.9 - z * 0.55);
      return { sx: cx + x * R * k, sy: cy + y * R * k, z };
    };

    const frame = () => {
      const a = t * 0.0034;
      const head = (t * 0.0016) % 1;
      ctx.clearRect(0, 0, size, size);
      const pr = pts.map((p) => project(p, a));

      for (const [i, j] of edges) {
        const A = pr[i], B = pr[j];
        const depth = (A.z + B.z) / 2;
        ctx.strokeStyle = `rgba(${NEAR},${(0.1 + (Math.max(0, depth + 1) / 2) * 0.24).toFixed(3)})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(A.sx, A.sy);
        ctx.lineTo(B.sx, B.sy);
        ctx.stroke();
      }

      for (let i = 0; i < N; i++) {
        const P = pr[i];
        const depth = (P.z + 1) / 2;
        let d = Math.abs(i / N - head);
        if (d > 0.5) d = 1 - d;
        const lit = frozen ? 0 : Math.max(0, 1 - d * 11);
        const rad = (0.8 + depth * 1.3) * (1 + lit * 0.8);
        const base = 0.32 + depth * 0.55;
        ctx.fillStyle = `rgba(${depth > 0.62 ? NEAR : FAR},${Math.min(1, base + lit * 0.5).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(P.sx, P.sy, rad, 0, 6.284);
        ctx.fill();
      }

      if (!frozen) {
        t += 16;
        raf = requestAnimationFrame(frame);
      }
    };

    frame();
    return () => cancelAnimationFrame(raf);
  }, [size, waiting, still]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
