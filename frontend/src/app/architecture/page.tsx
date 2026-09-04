"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, MousePointer2 } from "lucide-react";
import { NODE_MAP } from "@/components/architecture/agentData";

/* Three.js touches window/document at import time -- ssr:false keeps this
   off the server render entirely rather than crashing it. */
const AgentUniverse = dynamic(() => import("@/components/architecture/AgentUniverse"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center" style={{ color: "#7C8478" }}>
      loading the architecture…
    </div>
  ),
});

export default function ArchitecturePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? NODE_MAP[selectedId] : null;

  return (
    <main className="fixed inset-0" style={{ background: "#050a08" }}>
      <AgentUniverse selectedId={selectedId} onSelect={setSelectedId} />

      {/* Top-left: identity + back link */}
      <div className="absolute top-0 left-0 p-6 pointer-events-none">
        <Link
          href="/"
          className="pointer-events-auto inline-flex items-center gap-1.5 text-[12px] mb-4 transition-opacity hover:opacity-70"
          style={{ color: "#9BA69F" }}
        >
          <ArrowLeft size={13} /> Back to sign in
        </Link>
        <h1
          className="font-bold text-2xl tracking-tight"
          style={{ color: "#F5F6EF", fontFamily: "Georgia, serif" }}
        >
          PlacePilot AI — Agent Architecture
        </h1>
        <p className="text-[13px] mt-1 max-w-sm" style={{ color: "#7C8478" }}>
          Two loop agents on one shared engine, plus four one-shot specialists. Every tool listed here is a live function in the deployed backend.
        </p>
        <div className="flex items-center gap-1.5 mt-3 text-[11px]" style={{ color: "#5A665F" }}>
          <MousePointer2 size={12} /> drag to rotate · scroll to zoom · click a node
        </div>
      </div>

      {/* Bottom-left: legend */}
      <div className="absolute bottom-6 left-6 flex items-center gap-4 text-[11px] pointer-events-none" style={{ color: "#7C8478" }}>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#F5F6EF" }} /> engine</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#0FA968" }} /> loop agent (picks a tool every step)</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#9B7CD9" }} /> one-shot specialist</span>
      </div>

      {/* Right: detail panel */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-6 right-6 w-[360px] rounded-2xl p-5"
            style={{
              background: "rgba(11,23,20,0.88)",
              border: `1px solid ${selected.color}55`,
              boxShadow: `0 0 40px ${selected.color}22`,
              backdropFilter: "blur(10px)",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: selected.color, boxShadow: `0 0 8px ${selected.color}` }} />
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: selected.color }}>
                {selected.kind === "core" ? "The Engine" : selected.kind === "loop" ? "Loop Agent" : "One-Shot Specialist"}
              </span>
            </div>
            <h2 className="text-lg font-bold mb-2.5" style={{ color: "#F5F6EF", fontFamily: "Georgia, serif" }}>
              {selected.label}
            </h2>
            <p className="text-[13px] leading-relaxed mb-3.5" style={{ color: "#C9D6CE" }}>
              {selected.role}
            </p>
            {selected.tools && (
              <div>
                <div className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: "#5A665F" }}>
                  Tools
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.tools.map((t) => (
                    <span
                      key={t}
                      className="text-[10.5px] px-2 py-1 rounded-md"
                      style={{ fontFamily: "Consolas, monospace", background: "rgba(255,255,255,0.06)", color: "#9BE8C0" }}
                    >
                      {t}()
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
