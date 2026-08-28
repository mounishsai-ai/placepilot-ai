"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Handshake, ShieldAlert } from "lucide-react";
import AgentOrb from "@/components/ui/AgentOrb";
import { scheduleAPI } from "@/lib/api";
import toast from "react-hot-toast";

/* Two agents, not a log. The TPO's scheduling agent and the company's own
   agent sit on opposite sides of a table; every step either one takes flies
   in from its own side, tilted in 3D (perspective + rotateY), instead of
   scrolling past as one more line in a list. A clean agreement gets a burst,
   the one moment this view is allowed to celebrate. */

interface TraceStep {
  seq: number;
  agent: string;
  kind: string;
  summary: string;
  detail: Record<string, unknown> | null;
  cost_ms: number | null;
  created_at: string;
}

interface NegotiationRun {
  id: string;
  status: "running" | "paused" | "completed" | "failed";
  pending_question: { question?: string; options?: string[] } | null;
  final_proposal: unknown[] | null;
  trace: TraceStep[];
}

const KIND_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  thought:     { label: "Reasoning",  color: "#4C79CF", bg: "rgba(76,121,207,.08)" },
  tool_call:   { label: "Action",     color: "#0A6B44", bg: "rgba(10,107,68,.08)" },
  observation: { label: "Result",     color: "#12B872", bg: "rgba(18,184,114,.08)" },
  decision:    { label: "Accepted",   color: "#7C5CBF", bg: "rgba(124,92,191,.10)" },
  ask_human:   { label: "Handoff",    color: "#D9922B", bg: "rgba(217,146,43,.10)" },
  violation:   { label: "Stalled",    color: "#C2453F", bg: "rgba(194,69,63,.08)" },
};

function ParticleBurst() {
  const particles = useRef(
    Array.from({ length: 16 }, (_, i) => {
      const angle = (i / 16) * Math.PI * 2;
      return { dx: Math.cos(angle) * (60 + Math.random() * 40), dy: Math.sin(angle) * (60 + Math.random() * 40) };
    })
  ).current;
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
      {particles.map((p, i) => (
        <motion.span
          key={i}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.dx, y: p.dy, opacity: 0, scale: 0.4 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="absolute w-1.5 h-1.5 rounded-full"
          style={{ background: i % 2 === 0 ? "#7C5CBF" : "#12B872" }}
        />
      ))}
    </div>
  );
}

function FlightCard({ step, side }: { step: TraceStep; side: "left" | "right" }) {
  const cfg = KIND_STYLE[step.kind] ?? { label: step.kind, color: "var(--faint)", bg: "var(--wash-2)" };
  const detail = step.detail ?? {};
  const toolName = typeof detail.name === "string" ? detail.name : null;
  return (
    <motion.div
      initial={{ opacity: 0, x: side === "left" ? -50 : 50, rotateY: side === "left" ? -30 : 30, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, rotateY: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={`max-w-[78%] rounded-xl px-3.5 py-2.5 ${side === "right" ? "ml-auto" : ""}`}
      style={{ background: cfg.bg, border: `1px solid ${cfg.color}33`, transformStyle: "preserve-3d" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: cfg.color }}>
          {cfg.label}
        </span>
        {toolName && (
          <span className="ct-mono text-[10px]" style={{ color: "var(--faint)" }}>{toolName}()</span>
        )}
      </div>
      <p className="text-[12.5px] leading-snug" style={{ color: "var(--fg)" }}>{step.summary}</p>
    </motion.div>
  );
}

export default function NegotiationArena({ roundId, canCommit }: { roundId: string; canCommit: boolean }) {
  const [run, setRun] = useState<NegotiationRun | null | undefined>(undefined);
  const [committing, setCommitting] = useState(false);
  const [burst, setBurst] = useState(false);
  const lastSeq = useRef(0);

  useEffect(() => {
    let stop = false;
    let id: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await scheduleAPI.getNegotiation(roundId);
        if (stop) return;
        const next: NegotiationRun | null = res.data.run;
        if (next) {
          const lastCompany = [...next.trace].reverse().find((t) => t.agent === "company_agent");
          if (lastCompany && lastCompany.seq > lastSeq.current && lastCompany.kind === "decision") {
            setBurst(true);
            setTimeout(() => setBurst(false), 1000);
          }
          if (lastCompany) lastSeq.current = lastCompany.seq;
          if ((next.status === "completed" || next.status === "failed") && id) {
            clearInterval(id);
          }
        }
        setRun(next);
      } catch {
        if (!stop) setRun(null);
      }
    };
    poll();
    id = setInterval(poll, 2500);
    return () => { stop = true; if (id) clearInterval(id); };
  }, [roundId]);

  const handleCommit = async () => {
    if (!run) return;
    setCommitting(true);
    try {
      const res = await scheduleAPI.commitNegotiation(run.id);
      toast.success(`Committed ${res.data.committed_count} slots`);
      setRun({ ...run, status: "completed" });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Failed to commit the negotiated schedule");
    } finally {
      setCommitting(false);
    }
  };

  if (run === undefined) {
    return <div className="glass-card h-40 animate-pulse" />;
  }
  if (run === null) {
    return (
      <div className="glass-card text-center py-10 text-sm" style={{ color: "var(--faint)" }}>
        No negotiation in progress for this round yet.
      </div>
    );
  }

  const roundsDone = run.trace.filter((t) => t.agent === "company_agent").length;
  // While running, show the round in progress (one ahead of the last completed
  // evaluation); once paused/done, show the round that actually concluded it.
  const roundDisplay = Math.min(run.status === "running" ? roundsDone + 1 : Math.max(roundsDone, 1), 3);
  const cards = run.trace;

  return (
    <div className="glass-card relative overflow-hidden" style={{ border: "1px solid var(--line)" }}>
      <AnimatePresence>{burst && <ParticleBurst />}</AnimatePresence>

      {/* The table — two agents facing off, with a live round counter between them. */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--line)", background: "var(--wash)" }}>
        <div className="flex items-center gap-2.5">
          <AgentOrb size={30} tone="jade" waiting={run.status === "paused"} />
          <div>
            <div className="text-[12.5px] font-semibold" style={{ color: "var(--fg)" }}>Scheduling Agent</div>
            <div className="text-[10px]" style={{ color: "var(--faint)" }}>TPO side</div>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="ct-mono text-[10px] tracking-wider" style={{ color: "var(--faint)" }}>
            ROUND {roundDisplay} / 3
          </span>
          {run.status === "running" && (
            <span className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--jade-d)" }}>
              <span className="ct-live-dot" /> negotiating
            </span>
          )}
          {run.status === "paused" && (
            <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "var(--gold-d)" }}>
              <Handshake size={11} /> ready for TPO
            </span>
          )}
          {run.status === "failed" && (
            <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "#C2453F" }}>
              <ShieldAlert size={11} /> stalled
            </span>
          )}
          {run.status === "completed" && (
            <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: "var(--jade-d)" }}>
              <Sparkles size={11} /> committed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="text-right">
            <div className="text-[12.5px] font-semibold" style={{ color: "var(--fg)" }}>Company Agent</div>
            <div className="text-[10px]" style={{ color: "var(--faint)" }}>HR side</div>
          </div>
          <AgentOrb size={30} tone="violet" />
        </div>
      </div>

      {/* The exchange itself — every step flies in from the side that took it. */}
      <div className="p-5 space-y-2.5 max-h-[420px] overflow-y-auto" style={{ perspective: 1000 }}>
        <AnimatePresence initial={false}>
          {cards.map((step) => (
            <FlightCard key={step.seq} step={step} side={step.agent === "company_agent" ? "right" : "left"} />
          ))}
        </AnimatePresence>
        {run.status === "running" && (
          <div className="flex items-center gap-2 text-[11px] pt-1" style={{ color: "var(--faint)" }}>
            <span className="ct-live-dot" /> thinking…
          </div>
        )}
      </div>

      {/* The one place a human acts — everything above was discussion. */}
      {run.status === "paused" && run.pending_question?.question && (
        <div className="p-5 pt-0">
          <div className="rounded-xl p-4" style={{ background: "var(--gold-lt)", border: "1px solid var(--gold-ln)" }}>
            <p className="text-[13px] leading-relaxed mb-3" style={{ color: "var(--fg)" }}>
              {run.pending_question.question}
            </p>
            {canCommit ? (
              <button onClick={handleCommit} disabled={committing} className="btn-primary text-[12.5px] disabled:opacity-50">
                {committing ? "Committing…" : "Commit this schedule"}
              </button>
            ) : (
              <p className="text-[11px]" style={{ color: "var(--faint)" }}>Waiting for the TPO to review and commit.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
