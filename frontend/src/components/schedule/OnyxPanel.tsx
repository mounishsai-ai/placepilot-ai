"use client";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Sparkles, ShieldAlert } from "lucide-react";
import AgentOrb from "@/components/ui/AgentOrb";
import NegotiationArena from "@/components/schedule/NegotiationArena";
import { agentAPI, scheduleAPI } from "@/lib/api";
import toast from "react-hot-toast";

/* Onyx sits above the negotiation, not inside it — its own tools dispatch and
   read the two-agent arena below rather than touching a schedule directly.
   This card is Onyx's dispatch line and report; the arena underneath is the
   unchanged real thing, complete with its own commit action. */

interface TraceStep {
  seq: number;
  agent: string;
  kind: string;
  summary: string;
  detail: Record<string, unknown> | null;
  cost_ms: number | null;
  created_at: string;
}

interface OnyxRun {
  id: string;
  status: "running" | "paused" | "completed" | "failed";
  pending_question: { question?: string; options?: string[] } | null;
  trace: TraceStep[];
}

const KIND_LABEL: Record<string, string> = {
  thought: "Reasoning",
  tool_call: "Dispatch",
  observation: "Result",
  ask_human: "Report",
  violation: "Stalled",
};

function OnyxLine({ step }: { step: TraceStep }) {
  const label = KIND_LABEL[step.kind] ?? step.kind;
  const detail = step.detail ?? {};
  const toolName = typeof detail.name === "string" ? detail.name : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-2.5 text-[12.5px] leading-snug"
    >
      <span
        className="mt-[3px] w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: step.kind === "violation" ? "#C2453F" : "var(--jade)" }}
      />
      <div>
        <span className="text-[9.5px] font-semibold uppercase tracking-wider mr-1.5" style={{ color: "var(--faint)" }}>
          {label}
        </span>
        {toolName && <span className="ct-mono text-[10px] mr-1.5" style={{ color: "var(--faint)" }}>{toolName}()</span>}
        <span style={{ color: "var(--fg)" }}>{step.summary}</span>
      </div>
    </motion.div>
  );
}

export default function OnyxPanel({ roundId, onCommitted }: { roundId: string; onCommitted?: () => void }) {
  const [run, setRun] = useState<OnyxRun | null | undefined>(undefined);
  const [acking, setAcking] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    let id: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await scheduleAPI.getOnyx(roundId);
        if (stopRef.current) return;
        const next: OnyxRun | null = res.data.run;
        setRun(next);
        if (next && (next.status === "completed" || next.status === "failed") && id) {
          clearInterval(id);
        }
      } catch {
        if (!stopRef.current) setRun(null);
      }
    };
    poll();
    id = setInterval(poll, 2200);
    return () => { stopRef.current = true; if (id) clearInterval(id); };
  }, [roundId]);

  const handleAck = async () => {
    if (!run) return;
    setAcking(true);
    try {
      await agentAPI.answer(run.id, "Reviewed — thanks, Onyx.");
      toast.success("Onyx's report acknowledged");
    } catch {
      toast.error("Failed to acknowledge Onyx's report");
    } finally {
      setAcking(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="glass-card" style={{ border: "1px solid var(--line)" }}>
        <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: "1px solid var(--line)", background: "var(--wash)" }}>
          <AgentOrb size={30} tone="onyx" waiting={run?.status === "paused"} />
          <div>
            <div className="text-[12.5px] font-semibold flex items-center gap-1.5" style={{ color: "var(--fg)" }}>
              <Crown size={12} style={{ color: "var(--faint)" }} /> Onyx
            </div>
            <div className="text-[10px]" style={{ color: "var(--faint)" }}>Supervisor — dispatches the two agents below</div>
          </div>
          <div className="ml-auto text-[10px]">
            {run === undefined && <span style={{ color: "var(--faint)" }}>starting…</span>}
            {run?.status === "running" && (
              <span className="flex items-center gap-1.5" style={{ color: "var(--jade-d)" }}>
                <span className="ct-live-dot" /> dispatching sub-agents
              </span>
            )}
            {run?.status === "paused" && (
              <span className="flex items-center gap-1 font-semibold" style={{ color: "var(--gold-d)" }}>
                report ready
              </span>
            )}
            {run?.status === "failed" && (
              <span className="flex items-center gap-1 font-semibold" style={{ color: "#C2453F" }}>
                <ShieldAlert size={11} /> stalled
              </span>
            )}
            {run?.status === "completed" && (
              <span className="flex items-center gap-1 font-semibold" style={{ color: "var(--jade-d)" }}>
                <Sparkles size={11} /> acknowledged
              </span>
            )}
          </div>
        </div>

        {run && run.trace.length > 0 && (
          <div className="px-5 py-4 space-y-2.5">
            <AnimatePresence initial={false}>
              {run.trace.map((step) => <OnyxLine key={step.seq} step={step} />)}
            </AnimatePresence>
          </div>
        )}

        {run?.status === "paused" && run.pending_question?.question && (
          <div className="px-5 pb-5">
            <div className="rounded-xl p-4" style={{ background: "var(--wash-2)", border: "1px solid var(--line)" }}>
              <p className="text-[13px] leading-relaxed mb-3" style={{ color: "var(--fg)" }}>
                {run.pending_question.question}
              </p>
              <button onClick={handleAck} disabled={acking} className="btn-ghost text-[12.5px] disabled:opacity-50">
                {acking ? "Sending…" : "Got it, Onyx"}
              </button>
            </div>
          </div>
        )}
      </div>

      <NegotiationArena roundId={roundId} canCommit onCommitted={onCommitted} />
    </div>
  );
}
