"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, CornerDownLeft } from "lucide-react";

/* The trace is one line of reasoning, so it's drawn as one line: a rail down
   the left with every step hung off it. The rail is unbroken while the agent is
   working on its own, and it breaks — dashed, amber — at the exact point it
   stopped and handed control to a person. That break is the whole argument of
   this project, so it's the only thing on the page that glows. */

export interface TraceStep {
  seq: number;
  agent: string;
  kind: string;
  summary: string;
  detail: Record<string, unknown> | null;
  cost_ms: number | null;
  created_at: string;
}

export interface AgentRun {
  id: string;
  drive_id: string;
  status: string;
  pending_question: { question?: string; options?: string[] } | null;
  created_at: string;
  updated_at: string;
  trace: TraceStep[];
}

const KIND: Record<string, { label: string; color: string }> = {
  thought:     { label: "Thought",   color: "#6f9dff" },
  tool_call:   { label: "Call",      color: "#b06ef7" },
  observation: { label: "Result",    color: "#22b8d4" },
  ask_human:   { label: "Asked you", color: "#f59e0b" },
  decision:    { label: "Decision",  color: "#10b981" },
  violation:   { label: "Stopped",   color: "#f43f5e" },
};

const ANSWER_PREFIX = "TPO answered:";

// ─── Formatting ──────────────────────────────────────────────────────────────

function ms(v: number): string {
  return v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(2)}s`;
}

/* sqrt, not linear: a 12ms database lookup and a 2.8s model turn both have to
   stay readable in the same column, and linear would flatten one into nothing. */
function costWidth(v: number): string {
  return `${Math.max(1, Math.min(100, Math.sqrt(v) * 2.2))}%`;
}

function readableKey(k: string): string {
  return k.replace(/_/g, " ");
}

/* Observation summaries are Python reprs (`{'eligible': 47, ...}`) sliced at
   2000 chars, so they can arrive cut mid-structure and never parse as JSON.
   The real data is in `detail`, which is a JSON column — read that instead and
   fall back to the string only when there's nothing structured to show. */
function summarizeResult(result: unknown): { line: string; error: boolean } {
  if (result === null || typeof result !== "object") {
    return { line: String(result), error: false };
  }
  const r = result as Record<string, unknown>;
  if (typeof r.error === "string") return { line: r.error, error: true };

  const bits: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) bits.push(`${readableKey(k)} ${v.length}`);
    else if (typeof v === "object") continue;
    else if (typeof v === "string") {
      bits.push(v.length > 44 ? `${readableKey(k)} ${v.length} chars` : `${readableKey(k)} ${v}`);
    } else bits.push(`${readableKey(k)} ${v}`);
  }
  return { line: bits.slice(0, 5).join("   ·   ") || "done", error: false };
}

// ─── Steps ───────────────────────────────────────────────────────────────────

function Step({ step, last, live }: { step: TraceStep; last: boolean; live: boolean }) {
  const [open, setOpen] = useState(false);
  const cfg = KIND[step.kind] ?? { label: step.kind, color: "rgba(255,255,255,0.5)" };

  const detail = step.detail ?? {};
  const toolName = typeof detail.name === "string" ? detail.name : null;
  const isAskHumanCall = step.kind === "tool_call" && toolName === "ask_human";
  const args = detail.args as Record<string, unknown> | undefined;
  const hasResult = "result" in detail;
  const result = hasResult ? summarizeResult(detail.result) : null;
  // The question itself renders once, in the Handoff card that follows — this
  // row just marks that the model decided to ask.
  const expandable = !isAskHumanCall && (hasResult || (args && Object.keys(args).length > 0));

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="relative pl-7 pb-5"
      style={{ color: cfg.color }}
    >
      <span
        className="ct-rail"
        style={last ? { background: `linear-gradient(to bottom, rgba(255,255,255,0.11), transparent)` } : undefined}
      />
      <span className={`ct-node ${live ? "ct-node-live" : ""}`} />

      {/* Latency to scale. Absent on rows the backend doesn't time — the row
          keeps its height either way so the column doesn't jitter. */}
      <div className="h-[2px] mb-2 flex items-center gap-2">
        {step.cost_ms !== null && (
          <>
            <div className="ct-cost" style={{ width: costWidth(step.cost_ms) }} />
            <span className="ct-mono text-[9px] shrink-0" style={{ color: cfg.color, opacity: 0.55 }}>
              {ms(step.cost_ms)}
            </span>
          </>
        )}
      </div>

      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="ct-mono text-[10px] text-white/20 tabular-nums">
          {String(step.seq).padStart(2, "0")}
        </span>
        <span className="ct-kind" style={{ color: cfg.color }}>{cfg.label}</span>
        {toolName && (
          <span className="ct-mono text-[11px] text-white/75">{toolName}</span>
        )}
      </div>

      {/* Thoughts and decisions are prose the model wrote; results are data. */}
      {step.kind === "thought" || step.kind === "decision" || step.kind === "violation" ? (
        <p className="text-[13.5px] leading-relaxed text-white/70 mt-1.5 max-w-[68ch]">
          {step.summary}
        </p>
      ) : result ? (
        <p
          className={`ct-mono text-[11.5px] leading-relaxed mt-1.5 max-w-[68ch] ${
            result.error ? "text-rose-300/90" : "text-white/45"
          }`}
        >
          {result.line}
        </p>
      ) : args && Object.keys(args).length > 0 ? (
        <p className="ct-mono text-[11.5px] text-white/35 mt-1.5 max-w-[68ch] truncate">
          {Object.entries(args)
            .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join("  ")}
        </p>
      ) : null}

      {expandable && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-white/25 hover:text-white/60 transition-colors rounded"
          >
            <ChevronRight size={10} className={open ? "rotate-90 transition-transform" : "transition-transform"} />
            {open ? "Hide" : "Show"} raw
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.pre
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="ct-mono ct-disclosure text-[10.5px] text-white/40 mt-2 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]"
              >
                {JSON.stringify(detail, null, 2)}
              </motion.pre>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.li>
  );
}

// ─── The break ───────────────────────────────────────────────────────────────

/* Answered handoffs stay in the trace as a closed exchange rather than two
   unrelated rows, so replaying a finished run still reads as a conversation. */
function Handoff({
  question,
  options,
  answer,
  onAnswer,
  sending,
}: {
  question: string;
  options?: string[];
  answer?: string;
  onAnswer?: (a: string) => void;
  sending?: boolean;
}) {
  const [text, setText] = useState("");
  const open = !answer;

  const send = (value: string) => {
    const v = value.trim();
    if (!v || sending || !onAnswer) return;
    onAnswer(v);
    setText("");
  };

  return (
    <li className="relative pl-7 pb-5" style={{ color: "#f59e0b" }}>
      <span className={`ct-rail ${open ? "ct-rail-open" : ""}`} />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className={`rounded-xl p-5 ${open ? "ct-waiting" : "border border-white/[0.08] bg-white/[0.02]"}`}
      >
        <div className="ct-kind mb-3" style={{ color: open ? "#f59e0b" : "rgba(255,255,255,0.3)" }}>
          {open ? "Waiting for you" : "You answered"}
        </div>

        {/* The agent talks to itself in mono. Here it's talking to a person, so
            it gets the human typeface. */}
        <p className="text-[15px] leading-relaxed text-white/90 max-w-[62ch]">{question}</p>

        {answer ? (
          <div className="mt-4 flex items-start gap-2.5">
            <CornerDownLeft size={13} className="text-emerald-400/70 mt-1 shrink-0" />
            <p className="text-[13.5px] text-emerald-300/90 leading-relaxed">{answer}</p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {options && options.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {options.map((opt) => (
                  <button
                    key={opt}
                    disabled={sending}
                    onClick={() => send(opt)}
                    className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-amber-200 border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 hover:border-amber-400/50 disabled:opacity-40 transition-all"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={text}
                disabled={sending}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send(text)}
                placeholder="Or write your own answer…"
                className="input-glass flex-1 !py-2.5 !text-[13px]"
              />
              <button
                onClick={() => send(text)}
                disabled={sending || !text.trim()}
                className="btn-ghost !px-4 disabled:opacity-30"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </li>
  );
}

// ─── Trace ───────────────────────────────────────────────────────────────────

export default function AgentTrace({
  run,
  onAnswer,
  sending,
}: {
  run: AgentRun;
  onAnswer: (answer: string) => void;
  sending: boolean;
}) {
  const steps = run.trace;
  const rows: React.ReactNode[] = [];
  const running = run.status === "running";

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.kind === "ask_human") {
      // The answer arrives as the next observation, not as part of this row.
      const next = steps[i + 1];
      const answered =
        next && next.kind === "observation" && next.summary.startsWith(ANSWER_PREFIX)
          ? next.summary.slice(ANSWER_PREFIX.length).trim()
          : undefined;
      if (answered) i++;

      const d = (step.detail ?? {}) as { question?: string; options?: string[] };
      rows.push(
        <Handoff
          key={step.seq}
          question={d.question || step.summary}
          options={d.options}
          answer={answered}
          onAnswer={onAnswer}
          sending={sending}
        />
      );
      continue;
    }

    rows.push(
      <Step
        key={step.seq}
        step={step}
        last={i === steps.length - 1 && !running}
        live={running && i === steps.length - 1}
      />
    );
  }

  return (
    <ol className="relative">
      <AnimatePresence initial={false}>{rows}</AnimatePresence>

      {running && (
        <li className="relative pl-7 pb-2" style={{ color: "rgba(255,255,255,0.35)" }}>
          <span
            className="ct-rail"
            style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0.11), transparent)" }}
          />
          <div className="flex items-center gap-2 text-white/30 text-[12px] pt-0.5">
            <span className="ct-live-dot" />
            Thinking…
          </div>
        </li>
      )}
    </ol>
  );
}
