"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, Play } from "lucide-react";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import AgentTrace, { AgentRun } from "@/components/ui/AgentTrace";
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

export default function ControlTowerPage({ params }: { params: { id: string } }) {
  const driveId = params.id;
  const [drive, setDrive] = useState<Drive | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);

  const { connected } = useTPOWebSocket();
  const { agentEvents } = useDashboardStore();

  /* The resume endpoint hands control to a background task and returns before
     the agent picks the answer up, so the run reads "paused" for a moment after
     answering. Keep polling through that window instead of stopping early. */
  const answeredAt = useRef(0);

  const fetchRun = useCallback(async (id: string) => {
    try {
      const res = await agentAPI.getRun(id);
      const data: AgentRun = res.data;
      setRun(data);
      if (data.status === "running") setPolling(true);
      else if (data.status === "paused") setPolling(Date.now() - answeredAt.current < 25000);
      else setPolling(false);
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
    answeredAt.current = Date.now();
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
  const measured = run?.trace.reduce((sum, s) => sum + (s.cost_ms ?? 0), 0) ?? 0;

  return (
    <div className="min-h-screen bg-cosmic flex">
      <TPOSidebar />
      <div className="ml-64 flex-1 flex flex-col min-h-screen">
        <TopBar
          title="Control Tower"
          subtitle={drive ? `${drive.title} · ${drive.company}` : "Watch the agent work"}
          connected={connected}
        />

        <main className="p-8">
          <Link
            href="/tpo/drives"
            className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/80 text-xs mb-6 transition-colors rounded"
          >
            <ArrowLeft size={13} /> All drives
          </Link>

          <div className="glass p-7 max-w-4xl">
            {/* Run header — the agent's own vitals, in the agent's own typeface */}
            <div className="flex items-start justify-between gap-4 pb-6 mb-7 border-b border-white/[0.07]">
              <div>
                <h2 className="text-white font-semibold text-[17px]">
                  {run ? "This is what the agent did" : "Nothing has run yet"}
                </h2>
                <p className="text-white/35 text-[12.5px] mt-1 max-w-[56ch] leading-relaxed">
                  {run
                    ? "Every step below was chosen by the model, not by a script. Where it stopped, it stopped to ask you."
                    : "Start the agent and it will read the job description, check who qualifies, rank them, then stop and ask before finalising anything."}
                </p>
              </div>

              {run && status && (
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={status.className}>
                    {run.status === "running" && <span className="ct-live-dot" />}
                    {status.label}
                  </span>
                  <span
                    className="ct-mono text-[10px] text-white/25"
                    title="Measured model and tool latency for this run"
                  >
                    {run.trace.length} steps · {(measured / 1000).toFixed(1)}s
                  </span>
                  <span className="ct-mono text-[10px] text-white/15">run {run.id.slice(0, 8)}</span>
                </div>
              )}
            </div>

            {loading ? (
              <p className="text-white/30 text-sm py-10 text-center">Loading…</p>
            ) : !run || run.trace.length === 0 ? (
              <div className="py-12 text-center">
                {runId && (
                  <p className="text-white/35 text-[13px] mb-5 flex items-center justify-center gap-2">
                    <span className="ct-live-dot" /> Starting up…
                  </p>
                )}
                {/* Gated on runId, not run: the instant start returns a run_id,
                    this has to disappear even though the first poll hasn't
                    landed yet — otherwise a second click starts a concurrent run. */}
                {!runId && (
                  <button onClick={startAgent} disabled={starting} className="btn-primary inline-flex items-center gap-2">
                    <Play size={15} />
                    {starting ? "Starting…" : "Start the agent"}
                  </button>
                )}
              </div>
            ) : (
              <AgentTrace run={run} onAnswer={answer} sending={sending} />
            )}

            {run && (run.status === "completed" || run.status === "failed") && (
              <div className="pt-6 mt-2 border-t border-white/[0.07]">
                <button onClick={startAgent} disabled={starting} className="btn-ghost inline-flex items-center gap-2">
                  <Play size={13} />
                  {starting ? "Starting…" : "Run it again"}
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
