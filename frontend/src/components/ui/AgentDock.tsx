"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronUp, ExternalLink } from "lucide-react";
import AgentOrb from "./AgentOrb";
import { agentAPI } from "@/lib/api";
import toast from "react-hot-toast";

/* The agent, present on every screen.

   The Control Tower answers "what did the agent do on this drive"; it only
   helps if you're already on that drive. This answers the question a TPO
   actually carries around — "is anything waiting on me right now?" — from
   wherever they are, and doubles as the place to answer it.

   It shows ONE run at a time, chosen by the server: paused outranks running,
   and among paused the one blocked longest wins. When more than one is live
   the count is shown, and the rest are a click away in the Tower. That's a
   deliberate choice over listing them — the dock offers inline Approve /
   Send back, and those buttons have to be unambiguous about which run they
   act on. */

interface LiveRun {
  id: string;
  drive_id: string;
  drive_title: string;
  company: string;
  status: string;
  pending_question: {
    question?: string;
    options?: string[];
    audit?: { verdict: "clear" | "flag"; concerns: string[] };
  } | null;
  last_step: { seq: number; kind: string; summary: string } | null;
  updated_at: string;
}

const KIND_VERB: Record<string, string> = {
  thought: "thinking",
  tool_call: "running",
  observation: "read back",
  ask_human: "waiting on you",
  decision: "finished",
  violation: "stopped",
};

export default function AgentDock() {
  const [runs, setRuns] = useState<LiveRun[]>([]);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");

  /* The answer endpoint hands off to a background task and returns before the
     agent picks the answer up, so the run still reads "paused" for a moment.
     The dock keeps its own window rather than borrowing the Control Tower
     page's — otherwise an answered run looks stuck here while the Tower shows
     it resumed. */
  const answeredAt = useRef(0);

  /* /live only ever returns RUNNING/PAUSED runs, so a run that finishes
     between polls just vanishes from the list — including a "decision" run
     that ended by explaining why it couldn't do what the TPO asked (no
     violation, no ask_human, just a final message). Track what was visible
     last poll so a run that drops out can be given one last fetch to surface
     that final word instead of disappearing silently (observed live
     2026-08-28 — a TPO's answer produced a real "I can't do that" reply that
     nobody ever saw). */
  const prevIdsRef = useRef<Set<string>>(new Set());

  const fetchLive = useCallback(async () => {
    try {
      const res = await agentAPI.live();
      const newRuns: LiveRun[] = res.data ?? [];
      const newIds = new Set(newRuns.map((r) => r.id));

      for (const id of prevIdsRef.current) {
        if (newIds.has(id)) continue;
        agentAPI.getRun(id).then((r) => {
          const trace = r.data?.trace ?? [];
          const last = trace[trace.length - 1];
          if (!last) return;
          if (r.data.status === "completed") {
            toast(last.summary, { icon: "🤖", duration: 7000 });
          } else if (r.data.status === "failed") {
            toast.error(last.summary || "The agent hit an error and stopped.", { duration: 7000 });
          }
        }).catch(() => {});
      }

      prevIdsRef.current = newIds;
      setRuns(newRuns);
    } catch {
      /* a failed poll is not worth a toast — the next one is 2s away */
    }
  }, []);

  useEffect(() => {
    fetchLive();
    const t = setInterval(fetchLive, 2500);
    return () => clearInterval(t);
  }, [fetchLive]);

  const run = runs[0];
  const paused = run?.status === "paused";

  /* The strip is fixed to the viewport bottom, so on a scrollable page it
     covers the last row. Pages can't reserve the space themselves — they
     don't know whether the agent is running — so the dock reserves it, and
     gives it back the moment it leaves. Must sit above the early return
     below: hooks can't be conditional. */
  useEffect(() => {
    const on = Boolean(run);
    document.body.classList.toggle("has-agent-dock", on);
    return () => document.body.classList.remove("has-agent-dock");
  }, [run]);

  // Nothing in flight and nothing blocked — the dock stays out of the way
  // entirely rather than sitting there saying "idle".
  if (!run) return null;

  const answer = async (value: string) => {
    const v = value.trim();
    if (!v || sending) return;
    setSending(true);
    answeredAt.current = Date.now();
    try {
      await agentAPI.answer(run.id, v);
      setText("");
      toast.success("Sent — the agent is picking it up");
      await fetchLive();
    } catch {
      toast.error("Couldn't send your answer");
    } finally {
      setSending(false);
    }
  };

  const gold = paused;

  return (
    <div className="fixed bottom-0 left-64 right-0 z-40 pointer-events-none">
      <AnimatePresence>
        {open && paused && run.pending_question && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto mx-5 mb-1 p-4 rounded-xl bg-white"
            style={{ border: "1px solid var(--gold-ln)", boxShadow: "0 -6px 30px rgba(217,146,43,.14)" }}
          >
            {run.pending_question.audit?.verdict === "flag" &&
              run.pending_question.audit.concerns.length > 0 && (
                <div className="mb-2 text-[11.5px] font-medium" style={{ color: "#7C5CBF" }}>
                  ⚖ Auditor flagged: {run.pending_question.audit.concerns[0]}
                  {run.pending_question.audit.concerns.length > 1 &&
                    ` (+${run.pending_question.audit.concerns.length - 1} more — see trace)`}
                </div>
              )}
            <p className="text-[14px] leading-relaxed max-w-[70ch]" style={{ color: "var(--fg)" }}>
              {run.pending_question.question}
            </p>
            <div className="flex flex-wrap gap-2 mt-3.5 items-center">
              {(run.pending_question.options ?? []).map((opt) => (
                <button
                  key={opt}
                  disabled={sending}
                  onClick={() => answer(opt)}
                  className="px-3.5 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-40 transition-all"
                  style={{
                    color: "var(--gold-d)",
                    background: "var(--gold-lt)",
                    border: "1px solid var(--gold-ln)",
                  }}
                >
                  {opt}
                </button>
              ))}
              <input
                value={text}
                disabled={sending}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && answer(text)}
                placeholder="Or tell it what to change…"
                className="input-glass flex-1 min-w-[220px] !py-2 !text-[13px]"
              />
              <button
                onClick={() => answer(text)}
                disabled={sending || !text.trim()}
                className="btn-primary !py-2 !px-4 !text-[13px] disabled:opacity-30"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The strip itself */}
      <div
        className="pointer-events-auto mx-5 mb-4 rounded-xl flex items-center gap-3 px-4 py-2.5 bg-white"
        style={{
          border: `1px solid ${gold ? "var(--gold-ln)" : "var(--line)"}`,
          boxShadow: gold
            ? "0 6px 26px rgba(217,146,43,.16)"
            : "0 6px 22px rgba(11,23,20,.08)",
        }}
      >
        <AgentOrb size={26} waiting={gold} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-semibold tracking-[-0.014em]">{run.company}</span>
            <span className="ct-mono text-[10.5px]" style={{ color: "var(--faint)" }}>
              {run.drive_title}
            </span>
          </div>
          <div className="text-[11.5px] mt-0.5 truncate" style={{ color: gold ? "var(--gold-d)" : "var(--ash)" }}>
            {paused
              ? "Stopped and waiting for your decision"
              : run.last_step
                ? `${KIND_VERB[run.last_step.kind] ?? run.last_step.kind} · ${run.last_step.summary}`
                : "Starting up…"}
          </div>
        </div>

        {runs.length > 1 && (
          <span
            className="ct-mono text-[10px] px-2 py-1 rounded-full shrink-0"
            style={{ background: "var(--gold-lt)", color: "var(--gold-d)", border: "1px solid var(--gold-ln)" }}
          >
            +{runs.length - 1} more
          </span>
        )}

        {!paused && run.last_step && (
          <span className="ct-mono text-[10px] shrink-0" style={{ color: "var(--faint)" }}>
            step {run.last_step.seq}
          </span>
        )}

        {paused && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-lg shrink-0 transition-all inline-flex items-center gap-1.5"
            style={{ background: "var(--gold)", color: "#fff" }}
          >
            {open ? "Close" : "Answer"}
            <ChevronUp size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
          </button>
        )}

        <Link
          href={`/tpo/drives/${run.drive_id}/agent`}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg shrink-0 inline-flex items-center gap-1.5"
          style={{ color: "var(--jade-d)", background: "var(--wash)", border: "1px solid #CBEDDD" }}
        >
          Watch Onyx think <ExternalLink size={11} />
        </Link>
      </div>
    </div>
  );
}
