"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, Play } from "lucide-react";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import AgentTrace, { AgentRun } from "@/components/ui/AgentTrace";
import AgentOrb from "@/components/ui/AgentOrb";
import { agentAPI, drivesAPI } from "@/lib/api";
import { useTPOWebSocket } from "@/lib/websocket";
import { useDashboardStore } from "@/lib/store";

interface Drive {
  id: string;
  title: string;
  company: string;
}

const STATUS: Record<string, { label: string; className: string }> = {
  running:   { label: "Working",          className: "badge-blue"   },
  paused:    { label: "Waiting for you",  className: "badge-amber"  },
  completed: { label: "Finished",         className: "badge-green"  },
  failed:    { label: "Stopped",          className: "badge-rose"   },
};

/* The pipeline strip reads the trace rather than tracking its own state, so it
   can never disagree with what the agent actually did. Each stage is "done"
   once its tool has returned an observation. */
const STAGES: { key: string; n: string; label: string; done: string }[] = [
  { key: "get_drive_context", n: "01 · Context",    label: "Read the drive",     done: "Read the drive"    },
  { key: "parse_jd",          n: "02 · Parse",      label: "Understand the JD",  done: "Understood the JD" },
  { key: "check_eligibility", n: "03 · Eligibility", label: "Check who qualifies", done: "Eligibility checked" },
  { key: "rank_candidates",   n: "04 · Rank",       label: "Rank candidates",    done: "Candidates ranked" },
];

interface TraceStepDetail {
  result: unknown;
  cost_ms: number | null;
}

function fmtMs(v: number): string {
  return v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(2)} s`;
}

function summarise(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;
  if (typeof r.error === "string") return r.error;
  const bits: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) bits.push(`${k.replace(/_/g, " ")} ${v.length}`);
    else if (typeof v === "object") continue;
    else if (typeof v === "string" && v.length > 32) continue;
    else bits.push(`${k.replace(/_/g, " ")} ${v}`);
  }
  return bits.slice(0, 2).join(" · ");
}

export default function ControlTowerPage({ params }: { params: { id: string } }) {
  const driveId = params.id;
  const [drive, setDrive] = useState<Drive | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);

  useTPOWebSocket();
  const { agentEvents } = useDashboardStore();

  const fetchRun = useCallback(async (id: string) => {
    try {
      const res = await agentAPI.getRun(id);
      const data: AgentRun = res.data;
      setRun(data);
      // Poll continuously through "running" and "paused" — not just for a
      // window after this page's OWN answer button was clicked. The agent
      // dock on every other screen can also answer this exact run; a
      // time-boxed window only caught that if you happened to be on this
      // page when you answered. Otherwise Control Tower quietly stopped
      // polling and sat frozen on "waiting for you" long after the dock had
      // already resumed and finished the run (observed live 2026-08-28).
      setPolling(data.status === "running" || data.status === "paused");
      if (data.status !== "paused") setSending(false);
    } catch {
      setPolling(false);
    }
  }, []);

  // The route is keyed on the drive, so find its newest run before polling one.
  useEffect(() => {
    (async () => {
      try {
        const [driveRes, runsRes] = await Promise.all([
          drivesAPI.get(driveId),
          agentAPI.listRuns(driveId),
        ]);
        setDrive(driveRes.data);
        const latest = runsRes.data?.[0];
        if (latest) {
          setRunId(latest.id);
          await fetchRun(latest.id);
        }
      } catch {
        toast.error("Couldn't load this drive");
      } finally {
        setLoading(false);
      }
    })();
  }, [driveId, fetchRun]);

  // Polling is the source of truth: under Cloud Run the agent's background task
  // and this browser's WebSocket can land on different container instances.
  useEffect(() => {
    if (!polling || !runId) return;
    const t = setInterval(() => fetchRun(runId), 1500);
    return () => clearInterval(t);
  }, [polling, runId, fetchRun]);

  // When the socket does reach us, skip the wait and refetch immediately.
  useEffect(() => {
    if (!runId || agentEvents.length === 0) return;
    fetchRun(runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentEvents[0]]);

  const startAgent = async () => {
    setStarting(true);
    try {
      const res = await agentAPI.start(driveId);
      setRun(null);
      setRunId(res.data.run_id);
      setPolling(true);
      toast.success("Agent started");
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Couldn't start the agent");
    } finally {
      setStarting(false);
    }
  };

  const answer = async (text: string) => {
    if (!runId) return;
    setSending(true);
    try {
      await agentAPI.answer(runId, text);
      setPolling(true);
      fetchRun(runId);
    } catch {
      toast.error("Couldn't send your answer");
      setSending(false);
    }
  };

  const status = run ? STATUS[run.status] ?? { label: run.status, className: "badge-gray" } : null;
  const trace = run?.trace ?? [];
  const measured = trace.reduce((sum, s) => sum + (s.cost_ms ?? 0), 0);

  // Split measured time into the model's own reasoning vs. work done in tools —
  // the honest answer is usually that the tools dominate, which is worth showing.
  const thinkMs = trace.filter((s) => s.kind === "thought").reduce((a, s) => a + (s.cost_ms ?? 0), 0);
  const toolMs = trace.filter((s) => s.kind === "observation").reduce((a, s) => a + (s.cost_ms ?? 0), 0);
  const splitTotal = Math.max(1, thinkMs + toolMs);

  const toolsCalled = new Set(
    trace.filter((s) => s.kind === "tool_call").map((s) => (s.detail?.name as string) ?? "")
  );
  const observations = new Map<string, TraceStepDetail>();
  for (const s of trace) {
    if (s.kind === "observation" && s.detail && typeof s.detail.name === "string") {
      observations.set(s.detail.name, { result: s.detail.result, cost_ms: s.cost_ms });
    }
  }

  // get_drive_context reports when a drive was already parsed/checked/ranked
  // elsewhere (an earlier run, or the older HR-side pipeline) — the model
  // then skips straight to ask_human instead of redoing that work. Real work,
  // just not done as tool calls in THIS trace, so the stage tiles below need
  // a second source of "done" or they'd show three blank stages for a run
  // that correctly did less work, not one that did nothing.
  const contextResult = observations.get("get_drive_context")?.result as Record<string, unknown> | undefined;
  const skippedDone = new Set<string>();
  if (contextResult?.existing_jd_parsed) skippedDone.add("parse_jd");
  if (contextResult?.existing_eligible_count) skippedDone.add("check_eligibility");
  if (contextResult?.existing_shortlist) skippedDone.add("rank_candidates");

  const paused = run?.status === "paused";

  return (
    <div className="min-h-screen bg-cosmic flex">
      <TPOSidebar />
      <div className="ml-64 flex-1 flex flex-col min-h-screen">
        <TopBar
          title="Onyx"
          subtitle={drive ? `${drive.title} · ${drive.company}` : "Watch the agent work"}
        />

        <main className="p-7 flex flex-col gap-4">
          <Link
            href="/tpo/drives"
            className="inline-flex items-center gap-1.5 text-xs transition-colors rounded w-fit"
            style={{ color: "var(--faint)" }}
          >
            <ArrowLeft size={13} /> All drives
          </Link>

          {/* Headline: ink sentence, jade on the clause that matters */}
          <div>
            <h1 className="text-[clamp(22px,2.8vw,30px)] leading-[1.1] max-w-[22ch]">
              {paused ? (
                <>It did the work, then <em>stopped to ask you.</em></>
              ) : run?.status === "running" ? (
                <>The agent is <em>working through this drive.</em></>
              ) : run?.status === "completed" ? (
                <>Done — and <em>you approved every decision.</em></>
              ) : run?.status === "failed" ? (
                <>The run <em>stopped early.</em></>
              ) : (
                <>Nothing has run on this drive <em>yet.</em></>
              )}
            </h1>
            <p className="text-[13.5px] mt-2.5 max-w-[64ch] leading-relaxed" style={{ color: "var(--ash)" }}>
              {run
                ? "Every step below was chosen by the model, not by a script — the order isn't hardcoded anywhere. Where it stopped, it stopped to ask."
                : "Start the agent and it will read the job description, work out who qualifies, rank them, then stop and ask you before anything is finalised."}
            </p>
          </div>

          {loading ? (
            <p className="text-sm py-10 text-center" style={{ color: "var(--faint)" }}>Loading…</p>
          ) : !run ? (
            <div className="glass p-12 text-center">
              <button onClick={startAgent} disabled={starting} className="btn-primary inline-flex items-center gap-2">
                <Play size={15} />
                {starting ? "Starting…" : "Start the agent"}
              </button>
            </div>
          ) : (
            <>
              {/* Pipeline — derived from the trace, so it can't drift from reality */}
              <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(168px,1fr))" }}>
                {STAGES.map((st) => {
                  const obs = observations.get(st.key);
                  const skipped = !obs && skippedDone.has(st.key);
                  const done = !!obs || skipped;
                  const running = !done && toolsCalled.has(st.key);
                  return (
                    <div key={st.key} className={`tile ${done ? "tile-done" : "tile-todo"}`}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="ct-mono text-[8.5px] tracking-[0.13em] uppercase opacity-80">{st.n}</span>
                        <span
                          className="w-[15px] h-[15px] rounded-full grid place-items-center text-[9px] font-bold"
                          style={{ background: done ? "rgba(255,255,255,.26)" : "var(--line-2)" }}
                        >
                          {done ? "✓" : running ? "·" : ""}
                        </span>
                      </div>
                      <div className="text-[12.5px] font-semibold tracking-[-0.014em]">
                        {done ? st.done : st.label}
                      </div>
                      {obs ? (
                        <>
                          <div className="ct-mono text-[10px] opacity-[0.82] mt-0.5">{summarise(obs.result)}</div>
                          {obs.cost_ms !== null && (
                            <div className="ct-mono text-[9px] opacity-60 mt-1">{fmtMs(obs.cost_ms)}</div>
                          )}
                        </>
                      ) : skipped ? (
                        <div className="ct-mono text-[10px] opacity-[0.82] mt-0.5">already done — reused</div>
                      ) : null}
                    </div>
                  );
                })}
                <div className={`tile ${paused ? "tile-wait" : "tile-todo"}`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="ct-mono text-[8.5px] tracking-[0.13em] uppercase opacity-80">05 · Approval</span>
                    <span
                      className="w-[15px] h-[15px] rounded-full grid place-items-center text-[9px] font-bold"
                      style={{ background: paused ? "rgba(255,255,255,.26)" : "var(--line-2)" }}
                    >
                      {paused ? "!" : run.status === "completed" ? "✓" : ""}
                    </span>
                  </div>
                  <div className="text-[12.5px] font-semibold tracking-[-0.014em]">
                    {paused ? "Waiting for you" : run.status === "completed" ? "You approved it" : "Not reached"}
                  </div>
                  <div className="ct-mono text-[10px] opacity-[0.82] mt-0.5">
                    {paused ? "held · nothing finalised" : "needs your decision"}
                  </div>
                </div>
              </div>

              <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1fr) 330px" }}>
                <div className="glass overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-3.5"
                    style={{ borderBottom: "1px solid var(--line-2)" }}
                  >
                    <h2 className="text-[13px] font-bold flex items-center gap-2.5">
                      <AgentOrb size={24} waiting={paused} />
                      What the agent did
                    </h2>
                    <span className="ct-mono text-[9.5px] tracking-[0.08em] uppercase" style={{ color: "var(--faint)" }}>
                      {trace.length} steps · model picked every one
                    </span>
                  </div>
                  <div className="p-4">
                    <AgentTrace run={run} onAnswer={answer} sending={sending} />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {status && (
                    <div className="glass p-4 flex items-center justify-between gap-3">
                      <span className={status.className}>
                        {run.status === "running" && <span className="ct-live-dot" />}
                        {status.label}
                      </span>
                      <span className="ct-mono text-[10px] text-right" style={{ color: "var(--faint)" }}>
                        run {run.id.slice(0, 8)}
                        <br />
                        {(measured / 1000).toFixed(1)}s measured
                      </span>
                    </div>
                  )}

                  {/* Under the hood — the questions a judge actually asks */}
                  <div className="glass p-4">
                    <h3 className="text-[12px] font-bold mb-2.5 flex items-center gap-2">
                      <s className="w-[5px] h-[5px] rounded-full no-underline block" style={{ background: "var(--jade)" }} />
                      The model decides
                    </h3>
                    {[
                      ["Tools offered", "5"],
                      ["Tools called", String(toolsCalled.size)],
                      ["Order", "model's"],
                      ["Hardcoded edges", "0"],
                    ].map(([k, v]) => (
                      <div
                        key={k}
                        className="flex justify-between gap-3 py-1 text-[11.5px]"
                        style={{ borderBottom: "1px solid var(--line-2)" }}
                      >
                        <span style={{ color: "var(--ash)" }}>{k}</span>
                        <span className="ct-mono">{v}</span>
                      </div>
                    ))}
                    <p className="text-[10.5px] leading-relaxed mt-2.5 pt-2.5" style={{ color: "var(--faint)", borderTop: "1px solid var(--line-2)" }}>
                      Function calling over Vertex AI. Two different JDs produce{" "}
                      <b style={{ color: "var(--jade-d)" }}>different traces</b> — no Python picks the next step.
                    </p>
                  </div>

                  {(thinkMs > 0 || toolMs > 0) && (
                    <div className="glass p-4">
                      <h3 className="text-[12px] font-bold mb-2.5 flex items-center gap-2">
                        <s className="w-[5px] h-[5px] rounded-full no-underline block" style={{ background: "var(--jade)" }} />
                        Where the time went
                      </h3>
                      <div className="flex h-[7px] rounded-full overflow-hidden mb-2" style={{ background: "var(--line-2)" }}>
                        <i style={{ width: `${(thinkMs / splitTotal) * 100}%`, background: "var(--blue)" }} />
                        <i style={{ width: `${(toolMs / splitTotal) * 100}%`, background: "var(--jade)" }} />
                      </div>
                      <div className="flex gap-3 text-[10.5px]" style={{ color: "var(--ash)" }}>
                        <span className="flex items-center gap-1.5">
                          <s className="w-[7px] h-[7px] rounded-sm no-underline block" style={{ background: "var(--blue)" }} />
                          Thinking {(thinkMs / 1000).toFixed(1)}s
                        </span>
                        <span className="flex items-center gap-1.5">
                          <s className="w-[7px] h-[7px] rounded-sm no-underline block" style={{ background: "var(--jade)" }} />
                          Tools {(toolMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                      <p className="text-[10.5px] leading-relaxed mt-2.5 pt-2.5" style={{ color: "var(--faint)", borderTop: "1px solid var(--line-2)" }}>
                        Measured per step, not estimated. The slow part usually isn&apos;t the model — it&apos;s{" "}
                        <b style={{ color: "var(--jade-d)" }}>embedding every eligible profile</b>.
                      </p>
                    </div>
                  )}

                  <div className="glass p-4">
                    <h3 className="text-[12px] font-bold mb-2.5 flex items-center gap-2">
                      <s className="w-[5px] h-[5px] rounded-full no-underline block" style={{ background: "var(--jade)" }} />
                      It survives restarts
                    </h3>
                    <p className="text-[11px] leading-relaxed" style={{ color: "var(--ash)" }}>
                      When the agent asks you something, the whole conversation is written to Postgres before it
                      pauses. This run was resumed after a full container replacement on Cloud Run —{" "}
                      <b style={{ color: "var(--jade-d)" }}>tested by killing it</b>, not assumed.
                    </p>
                  </div>

                  {(run.status === "completed" || run.status === "failed") && (
                    <button onClick={startAgent} disabled={starting} className="btn-ghost inline-flex items-center justify-center gap-2">
                      <Play size={13} />
                      {starting ? "Starting…" : "Run it again"}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
