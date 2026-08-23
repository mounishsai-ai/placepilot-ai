"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase, Play, CheckCircle, Clock, AlertTriangle,
  ChevronDown, ChevronUp, Users, Star, X, Check,
  Building2, Calendar, TrendingUp, Zap,
} from "lucide-react";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import { drivesAPI } from "@/lib/api";
import { useTPOWebSocket } from "@/lib/websocket";
import { useDashboardStore } from "@/lib/store";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Drive {
  id: string;
  title: string;
  company: string;
  status: string;
  package_lpa: number | null;
  deadline: string | null;
  jd_parsed?: Record<string, unknown>;
}

interface ShortlistCandidate {
  student_id: string;
  name: string;
  roll_no: string;
  cgpa: number;
  branch: string;
  score: number;
  rank: number;
  shortlisted: boolean;
  explanation?: {
    strengths?: string[];
    gaps?: string[];
    one_liner?: string;
  };
}

interface AgentEvent {
  event_type: string;
  agent_name: string;
  drive_id?: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  draft:               "badge-gray",
  jd_analyzed:         "badge-blue",
  eligibility_checked: "badge-blue",
  matched:             "badge-blue",
  shortlist_pending:   "badge-amber",
  shortlist_approved:  "badge-green",
  schedule_pending:    "badge-amber",
  scheduled:           "badge-green",
  ongoing:             "badge-blue",
  completed:           "badge-green",
  cancelled:           "badge-rose",
};

const STATUS_LABEL: Record<string, string> = {
  draft:               "Draft",
  jd_analyzed:         "JD Analyzed",
  eligibility_checked: "Eligibility Done",
  matched:             "Candidates Ranked",
  shortlist_pending:   "⏸ Awaiting Approval",
  shortlist_approved:  "Shortlist Approved",
  schedule_pending:    "⏸ Schedule Review",
  scheduled:           "Interviews Scheduled",
  ongoing:             "Ongoing",
  completed:           "Completed",
};

const PIPELINE_STEPS = [
  { key: "draft",               label: "JD Upload",       icon: Briefcase },
  { key: "jd_analyzed",         label: "JD Analysis",     icon: Zap },
  { key: "eligibility_checked", label: "Eligibility",     icon: CheckCircle },
  { key: "matched",             label: "AI Matching",     icon: Star },
  { key: "shortlist_pending",   label: "TPO Review",      icon: AlertTriangle },
  { key: "shortlist_approved",  label: "Shortlisted",     icon: Users },
  { key: "scheduled",           label: "Scheduled",       icon: Calendar },
  { key: "completed",           label: "Completed",       icon: TrendingUp },
];

const STEP_ORDER = PIPELINE_STEPS.map((s) => s.key);

function stepStatus(driveStatus: string, stepKey: string): "done" | "active" | "pending" {
  const di = STEP_ORDER.indexOf(driveStatus);
  const si = STEP_ORDER.indexOf(stepKey);
  if (si < di) return "done";
  if (si === di) return "active";
  return "pending";
}

// ─── Pipeline Timeline Component ─────────────────────────────────────────────

function PipelineTimeline({ status }: { status: string }) {
  return (
    <div className="flex items-center gap-0 mt-4 overflow-x-auto pb-1">
      {PIPELINE_STEPS.map((step, i) => {
        const s = stepStatus(status, step.key);
        const Icon = step.icon;
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center gap-1 min-w-[72px]">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                s === "done"   ? "bg-emerald-500/20 border border-emerald-500/50" :
                s === "active" ? "bg-blue-500/20 border border-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.4)]" :
                                 "bg-white/[0.03] border border-white/10"
              }`}>
                <Icon size={14} className={
                  s === "done" ? "text-emerald-400" :
                  s === "active" ? "text-blue-400" : "text-white/20"
                } />
              </div>
              <span className={`text-[9px] text-center leading-tight ${
                s === "done" ? "text-emerald-400" :
                s === "active" ? "text-blue-400 font-semibold" : "text-white/20"
              }`}>{step.label}</span>
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <div className={`h-[2px] w-6 flex-shrink-0 mx-0.5 mb-4 transition-all ${
                stepStatus(status, PIPELINE_STEPS[i + 1].key) !== "pending"
                  ? "bg-emerald-500/40" : "bg-white/[0.06]"
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Shortlist Approval Modal ─────────────────────────────────────────────────

function ShortlistModal({
  driveId,
  candidates,
  onClose,
  onApproved,
}: {
  driveId: string;
  candidates: ShortlistCandidate[];
  onClose: () => void;
  onApproved: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(candidates.filter((c) => c.shortlisted).map((c) => c.student_id))
  );
  const [approving, setApproving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const approve = async () => {
    setApproving(true);
    try {
      await drivesAPI.approveShortlist(driveId, {
        approved: true,
        shortlisted_student_ids: Array.from(selected),
        notes: "Approved via TPO dashboard",
      });
      toast.success(`✅ Shortlist approved — ${selected.size} candidates`);
      onApproved();
    } catch {
      toast.error("Failed to approve shortlist");
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card w-full max-w-3xl max-h-[85vh] flex flex-col mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-white font-bold text-lg">⏸ Human-in-the-Loop: Review Shortlist</h2>
            <p className="text-white/40 text-sm">AI ranked {candidates.length} candidates — select who to shortlist</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* AI reasoning banner */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
          <Zap size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-blue-300 text-sm">
            <strong>AI pre-selected {candidates.filter(c => c.shortlisted).length} candidates</strong> based on vector similarity to the JD.
            You can add or remove candidates below before approving.
          </p>
        </div>

        {/* Candidate list */}
        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {candidates.map((c) => (
            <div
              key={c.student_id}
              className={`rounded-xl border transition-all ${
                selected.has(c.student_id)
                  ? "border-emerald-500/30 bg-emerald-500/[0.05]"
                  : "border-white/[0.06] bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-3 p-3">
                {/* Checkbox */}
                <button
                  onClick={() => toggle(c.student_id)}
                  className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all ${
                    selected.has(c.student_id)
                      ? "bg-emerald-500 border-emerald-500"
                      : "border border-white/20 bg-transparent"
                  }`}
                >
                  {selected.has(c.student_id) && <Check size={12} className="text-white" />}
                </button>

                {/* Rank */}
                <div className="w-7 h-7 rounded-lg bg-white/[0.05] flex items-center justify-center text-xs font-bold text-white/50">
                  #{c.rank}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium text-sm">{c.name}</span>
                    <span className="badge badge-gray text-[10px]">{c.branch}</span>
                  </div>
                  <div className="text-white/40 text-xs">{c.roll_no} · CGPA {c.cgpa}</div>
                </div>

                {/* Score */}
                <div className="text-right mr-2">
                  <div className="text-blue-400 font-bold text-sm">{Math.round(c.score * 100)}%</div>
                  <div className="text-white/25 text-[10px]">match</div>
                </div>

                {/* Expand explanation */}
                {c.explanation?.one_liner && (
                  <button
                    onClick={() => setExpanded(expanded === c.student_id ? null : c.student_id)}
                    className="text-white/30 hover:text-white/60 transition-colors"
                  >
                    {expanded === c.student_id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                )}
              </div>

              {/* Expanded AI explanation */}
              <AnimatePresence>
                {expanded === c.student_id && c.explanation && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-3 pt-0 space-y-2 border-t border-white/[0.05] mt-1">
                      {c.explanation.one_liner && (
                        <p className="text-white/60 text-xs italic">&ldquo;{c.explanation.one_liner}&rdquo;</p>
                      )}
                      {c.explanation.strengths?.length ? (
                        <div>
                          <div className="text-emerald-400 text-[10px] font-semibold mb-1">STRENGTHS</div>
                          {c.explanation.strengths.slice(0, 2).map((s, i) => (
                            <div key={i} className="text-white/50 text-xs flex gap-1.5">
                              <span className="text-emerald-400">✓</span> {s}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {c.explanation.gaps?.length ? (
                        <div>
                          <div className="text-rose-400 text-[10px] font-semibold mb-1">GAPS</div>
                          {c.explanation.gaps.slice(0, 2).map((g, i) => (
                            <div key={i} className="text-white/50 text-xs flex gap-1.5">
                              <span className="text-rose-400">△</span> {g}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-white/[0.06] mt-4">
          <div className="text-white/50 text-sm">
            <span className="text-white font-semibold">{selected.size}</span> of {candidates.length} selected
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button
              onClick={approve}
              disabled={approving || selected.size === 0}
              className="btn-primary flex items-center gap-2"
            >
              {approving ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Check size={16} />
              )}
              Approve Shortlist ({selected.size})
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Drive Card ───────────────────────────────────────────────────────────────

function DriveCard({
  drive,
  onRunPipeline,
  onReviewShortlist,
  onConfirmSchedule,
  liveEvents,
}: {
  drive: Drive;
  onRunPipeline: (id: string) => void;
  onReviewShortlist: (id: string) => void;
  onConfirmSchedule: (id: string) => void;
  liveEvents: AgentEvent[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [fetchedEvents, setFetchedEvents] = useState<AgentEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const loadEvents = async () => {
    if (fetchedEvents.length > 0) return;
    setLoadingEvents(true);
    try {
      const res = await drivesAPI.getEvents(drive.id);
      setFetchedEvents(res.data);
    } catch {}
    setLoadingEvents(false);
  };

  const toggleExpand = () => {
    if (!expanded) loadEvents();
    setExpanded(!expanded);
  };

  // Merge DB history (oldest→newest) with live WS events not yet in that history,
  // deduped by event_type+payload since the WS payload carries no server-side event id.
  const newLiveEvents = liveEvents
    .slice()
    .reverse() // store prepends newest-first; render oldest→newest to match fetched order
    .filter(
      (le) =>
        !fetchedEvents.some(
          (fe) => fe.event_type === le.event_type && JSON.stringify(fe.payload) === JSON.stringify(le.payload)
        )
    );
  const events = [...fetchedEvents, ...newLiveEvents];

  const EVENT_ICON: Record<string, string> = {
    pipeline_started:    "🚀",
    jd_analyzed:         "🧠",
    eligibility_checked: "✅",
    matching_complete:   "🔍",
    shortlist_pending:   "⏸️",
    shortlist_approved:  "👍",
    shortlist_rejected:  "👎",
    schedule_created:    "📅",
    schedule_pending:    "⏸️",
    schedule_approved:   "✅",
    schedule_rejected:   "↩️",
    notifications_queued: "📨",
    pipeline_error:      "❌",
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h3 className="text-white font-semibold text-base truncate max-w-md">{drive.title}</h3>
            <span className={`badge text-[10px] ${STATUS_COLOR[drive.status] ?? "badge-gray"}`}>
              {STATUS_LABEL[drive.status] ?? drive.status}
            </span>
          </div>
          <div className="flex items-center gap-4 text-white/40 text-xs flex-wrap">
            <span className="flex items-center gap-1"><Building2 size={11} />{drive.company}</span>
            {drive.package_lpa && (
              <span className="flex items-center gap-1"><TrendingUp size={11} />₹{drive.package_lpa} LPA</span>
            )}
            {drive.deadline && (
              <span className="flex items-center gap-1">
                <Calendar size={11} />Due {new Date(drive.deadline).toLocaleDateString("en-IN")}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {drive.status === "draft" && (
            <button
              onClick={() => onRunPipeline(drive.id)}
              className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3"
            >
              <Play size={13} /> Run Pipeline
            </button>
          )}
          {drive.status === "shortlist_pending" && (
            <button
              onClick={() => onReviewShortlist(drive.id)}
              className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3 !bg-amber-500/20 !border-amber-500/40 hover:!bg-amber-500/30"
            >
              <AlertTriangle size={13} className="text-amber-400" />
              <span className="text-amber-300">Review Shortlist</span>
            </button>
          )}
          {drive.status === "schedule_pending" && (
            <button
              onClick={() => onConfirmSchedule(drive.id)}
              className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3 !bg-amber-500/20 !border-amber-500/40 hover:!bg-amber-500/30"
            >
              <Calendar size={13} className="text-amber-400" />
              <span className="text-amber-300">Confirm Schedule</span>
            </button>
          )}
          <button
            onClick={toggleExpand}
            className="text-white/30 hover:text-white/70 transition-colors p-1"
          >
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
      </div>

      {/* Pipeline timeline */}
      <PipelineTimeline status={drive.status} />

      {/* Expanded events */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-white/[0.06]">
              <h4 className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">
                Agent Activity Log
              </h4>
              {loadingEvents ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 rounded-lg bg-white/[0.03] animate-pulse" />
                  ))}
                </div>
              ) : events.length === 0 ? (
                <p className="text-white/25 text-sm text-center py-4">
                  No events yet — run the pipeline to start
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {events.map((evt, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"
                    >
                      <span className="text-base flex-shrink-0">
                        {EVENT_ICON[evt.event_type] ?? "📌"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-white/70 text-xs font-medium capitalize">
                          {evt.event_type.replace(/_/g, " ")}
                        </div>
                        {evt.payload && Object.keys(evt.payload).length > 0 && (
                          <div className="text-white/35 text-[11px] mt-0.5">
                            {Object.entries(evt.payload)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(" · ")}
                          </div>
                        )}
                      </div>
                      <div className="text-white/20 text-[10px] whitespace-nowrap">
                        {new Date(evt.created_at).toLocaleTimeString("en-IN", {
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DrivesPage() {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [shortlistDriveId, setShortlistDriveId] = useState<string | null>(null);
  const [shortlistCandidates, setShortlistCandidates] = useState<ShortlistCandidate[]>([]);
  const [pollingActive, setPollingActive] = useState(false);
  const { connected } = useTPOWebSocket();
  const { agentEvents } = useDashboardStore();

  const ACTIVE_STATUSES = ["jd_analyzed", "eligibility_checked", "matched"];

  const fetchDrives = useCallback(async () => {
    try {
      const res = await drivesAPI.list();
      const data: Drive[] = res.data;
      setDrives(data);
      // Auto-poll while any drive is mid-pipeline
      const hasActive = data.some(d => ACTIVE_STATUSES.includes(d.status));
      setPollingActive(hasActive);
    } catch {
      toast.error("Failed to load drives");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { fetchDrives(); }, [fetchDrives]);

  // Auto-poll every 4s while pipeline is running (safety net if WS drops)
  useEffect(() => {
    if (!pollingActive) return;
    const interval = setInterval(fetchDrives, 4000);
    return () => clearInterval(interval);
  }, [pollingActive, fetchDrives]);

  // Live WS events refresh the list immediately instead of waiting on the poll
  useEffect(() => {
    if (agentEvents.length === 0) return;
    fetchDrives();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentEvents[0]]);

  const handleRunPipeline = async (id: string) => {
    setRunningId(id);
    try {
      await drivesAPI.runPipeline(id);
      toast.success("🚀 Pipeline started! Watch agent events below...", { duration: 4000 });
      // Refresh after a moment so status updates
      setTimeout(fetchDrives, 2000);
    } catch (err: unknown) {
      const msg = (err as {response?: {data?: {detail?: string}}})?.response?.data?.detail;
      toast.error(msg ?? "Failed to start pipeline");
    } finally {
      setRunningId(null);
    }
  };

  const handleReviewShortlist = async (id: string) => {
    try {
      const res = await drivesAPI.getShortlist(id);
      setShortlistCandidates(res.data);
      setShortlistDriveId(id);
    } catch {
      toast.error("Failed to load shortlist");
    }
  };

  const handleConfirmSchedule = async (id: string) => {
    try {
      await drivesAPI.approveSchedule(id, { approved: true });
      toast.success("✅ Schedule confirmed — students will be notified");
      fetchDrives();
    } catch (err: unknown) {
      const msg = (err as {response?: {data?: {detail?: string}}})?.response?.data?.detail;
      toast.error(msg ?? "Failed to confirm schedule");
    }
  };

  const statsBar = {
    total: drives.length,
    active: drives.filter((d) => ["jd_analyzed", "matched", "eligibility_checked", "ongoing"].includes(d.status)).length,
    pending: drives.filter((d) => ["shortlist_pending", "schedule_pending"].includes(d.status)).length,
    completed: drives.filter((d) => d.status === "completed").length,
  };

  return (
    <div className="min-h-screen bg-cosmic flex">
      <TPOSidebar />
      <div className="ml-64 flex-1 flex flex-col min-h-screen">
        <TopBar
          title="Placement Drives"
          subtitle={pollingActive
            ? "🔄 Pipeline running — auto-refreshing every 4s…"
            : "Manage drives and AI pipeline execution"
          }
          connected={connected}
        />

        <main className="p-8 space-y-6">
          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total Drives",   value: statsBar.total,     color: "text-white" },
              { label: "Active",         value: statsBar.active,    color: "text-blue-400" },
              { label: "Needs Review",   value: statsBar.pending,   color: "text-amber-400" },
              { label: "Completed",      value: statsBar.completed, color: "text-emerald-400" },
            ].map((stat) => (
              <div key={stat.label} className="glass-card text-center py-4">
                <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-white/40 text-xs mt-1">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Drives list */}
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="glass-card h-32 animate-pulse" />
              ))}
            </div>
          ) : drives.length === 0 ? (
            <div className="glass-card text-center py-16">
              <Briefcase size={40} className="text-white/10 mx-auto mb-3" />
              <p className="text-white/40">No drives yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {drives.map((drive) => (
                <DriveCard
                  key={drive.id}
                  drive={drive}
                  onRunPipeline={handleRunPipeline}
                  onReviewShortlist={handleReviewShortlist}
                  onConfirmSchedule={handleConfirmSchedule}
                  liveEvents={agentEvents.filter((e) => e.drive_id === drive.id)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Shortlist approval modal */}
      {shortlistDriveId && (
        <ShortlistModal
          driveId={shortlistDriveId}
          candidates={shortlistCandidates}
          onClose={() => setShortlistDriveId(null)}
          onApproved={() => {
            setShortlistDriveId(null);
            fetchDrives();
          }}
        />
      )}
    </div>
  );
}
