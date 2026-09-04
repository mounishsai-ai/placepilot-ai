"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase, Play, CheckCircle, Clock, AlertTriangle,
  ChevronDown, ChevronUp, Users, Star, X, Check,
  Building2, Calendar, TrendingUp, Zap, Search, Radio, Trash2, Plus,
} from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import { drivesAPI, scheduleAPI } from "@/lib/api";
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

/* badge-amber is reserved for the two states where the agent has stopped and
   needs the TPO. Everything else is jade (in flight or done) or grey (inert). */
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

/* Named for what the TPO sees happening, in plain words. The ones that need a
   person say so outright — that's the only state that ever gets gold. */
const STATUS_LABEL: Record<string, string> = {
  draft:               "Not started",
  jd_analyzed:         "Reading the JD",
  eligibility_checked: "Checking who qualifies",
  matched:             "Ranking candidates",
  shortlist_pending:   "Waiting for you",
  shortlist_approved:  "Shortlist approved",
  schedule_pending:    "Schedule needs review",
  scheduled:           "Interviews scheduled",
  ongoing:             "Ongoing",
  completed:           "Completed",
  cancelled:           "Cancelled",
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

const MASTER_ORDER = [
  "draft",
  "jd_analyzed",
  "eligibility_checked",
  "matched",
  "shortlist_pending",
  "shortlist_approved",
  "schedule_pending",
  "scheduled",
  "ongoing",
  "completed",
];

function stepStatus(driveStatus: string, stepKey: string): "done" | "active" | "pending" {
  const di = Math.max(0, MASTER_ORDER.indexOf(driveStatus));
  const si = Math.max(0, MASTER_ORDER.indexOf(stepKey));
  
  if (si < di) return "done";
  if (si === di) return "active";
  
  // If drive is in an intermediate state (e.g. schedule_pending), 
  // the next visual step (e.g. scheduled) should show as pending (or active if you prefer).
  return "pending";
}

// ─── Pipeline Timeline Component ─────────────────────────────────────────────

const AI_PROCESSING_STEPS = ["jd_analyzed", "eligibility_checked", "matched"];

function PipelineTimeline({ status }: { status: string }) {
  const isLiveProcessing = AI_PROCESSING_STEPS.includes(status);
  return (
    <div className="flex items-center gap-0 mt-4 overflow-x-auto pb-1">
      {PIPELINE_STEPS.map((step, i) => {
        const s = stepStatus(status, step.key);
        const Icon = step.icon;
        const pulsing = s === "active" && isLiveProcessing;
        return (
          <div key={step.key} className="flex items-center">
            <div className="flex flex-col items-center gap-1 min-w-[72px]">
              <motion.div
                animate={pulsing ? { scale: [1, 1.18, 1], opacity: [1, 0.65, 1] } : {}}
                transition={pulsing ? { duration: 1.3, repeat: Infinity, ease: "easeInOut" } : {}}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                s === "done"   ? "bg-emerald-500/20 border border-emerald-500/50" :
                s === "active" ? "bg-blue-500/20 border border-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.4)]" :
                                 "bg-white/[0.03] border border-white/10"
              }`}>
                <Icon size={14} className={
                  s === "done" ? "text-emerald-400" :
                  s === "active" ? "text-blue-400" : "text-white/20"
                } />
              </motion.div>
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

// ─── Create Drive Modal (TPO) ──────────────────────────────────────────────────
// Mirrors the HR wizard's inputs (company, title, JD) but stops right where
// HR's "Analyze JD" button would auto-launch the pipeline. A TPO-created
// drive lands in the list as a plain draft — the existing "Run Pipeline"
// button on the card is what starts it, on the TPO's own timing.

function CreateDriveModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [title, setTitle] = useState("");
  const [jdText, setJdText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    drivesAPI.listCompanies().then((res) => {
      setCompanies(res.data);
      if (res.data.length > 0) setCompanyId(res.data[0].id);
    }).catch(() => {});
  }, []);

  const create = async () => {
    if (!title.trim() || !companyId) {
      toast.error("Pick a company and give the drive a title");
      return;
    }
    if (!jdText.trim()) {
      toast.error("Paste a job description — Run Pipeline needs it to parse eligibility and rank candidates");
      return;
    }
    setCreating(true);
    try {
      await drivesAPI.create({
        company_id: companyId,
        title: title.trim(),
        jd_text: jdText.trim(),
        deadline: deadline || undefined,
      });
      toast.success("Drive created - run the pipeline on it whenever ready");
      onCreated();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Failed to create drive");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card w-full max-w-lg mx-4"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg">Create a <em>drive</em></h2>
          <button onClick={onClose} className="transition-colors hover:opacity-70" style={{ color: "var(--faint)" }}>
            <X size={20} />
          </button>
        </div>
        <p className="text-sm mb-4" style={{ color: "var(--ash)" }}>
          This only creates the drive - nothing runs until you click Run Pipeline on it.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs mb-1.5 block" style={{ color: "var(--ash)" }}>Company</label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full text-sm rounded-xl px-3 py-2.5 outline-none"
              style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
            >
              {companies.length === 0 && <option value="">No companies found</option>}
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs mb-1.5 block" style={{ color: "var(--ash)" }}>Drive title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Software Development Engineer 2025"
              className="input-glass !py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs mb-1.5 block" style={{ color: "var(--ash)" }}>Job description</label>
            <textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              rows={5}
              placeholder="Paste the JD text..."
              className="input-glass !py-2.5 text-sm resize-none"
            />
          </div>
          <div>
            <label className="text-xs mb-1.5 block" style={{ color: "var(--ash)" }}>Deadline (optional)</label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="input-glass !py-2.5 text-sm"
            />
          </div>
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={create} disabled={creating} className="btn-primary flex items-center gap-2">
            {creating ? (
              <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,.3)", borderTopColor: "#fff" }} />
            ) : (
              <Plus size={16} />
            )}
            Create Drive
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Confirm Dialog ────────────────────────────────────────────────────────────────
// The browser's own confirm() looks like every other site's confirm() — flat
// system chrome that breaks the moment it appears. This carries the same
// weight (blocks the action until answered) without the jarring context switch.

function ConfirmDialog({
  title, message, danger, onConfirm, onCancel,
}: {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card w-full max-w-sm mx-4"
      >
        <h2 className="text-lg mb-2">{title}</h2>
        <p className="text-sm mb-5" style={{ color: "var(--ash)" }}>{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-ghost">Cancel</button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl font-semibold text-white text-sm transition-all"
            style={{ background: danger ? "var(--rose)" : "var(--jade)" }}
          >
            {danger ? "Delete" : "Confirm"}
          </button>
        </div>
      </motion.div>
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
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCandidates = candidates.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.name || "").toLowerCase().includes(q) ||
      (c.roll_no || "").toLowerCase().includes(q)
    );
  });

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
      toast.success(`Shortlist approved — ${selected.size} candidates`);
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
        className="glass-card w-full max-w-3xl h-[85vh] flex flex-col mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            {/* Named for what the TPO is doing, not for the architecture. */}
            <h2 className="text-lg">The agent <em>ranked them. You decide.</em></h2>
            <p className="text-sm mt-0.5" style={{ color: "var(--ash)" }}>
              {candidates.length} candidates, ordered by how well they match the JD. Pick who moves forward.
            </p>
          </div>
          <button onClick={onClose} className="transition-colors hover:opacity-70" style={{ color: "var(--faint)" }}>
            <X size={20} />
          </button>
        </div>

        {/* AI reasoning banner */}
        <div className="rounded-xl px-4 py-3 mb-4 flex items-start gap-3" style={{ background: "var(--wash)", border: "1px solid #CBEDDD" }}>
          <Zap size={16} className="flex-shrink-0 mt-0.5" style={{ color: "var(--jade)" }} />
          <p className="text-sm" style={{ color: "var(--jade-d)" }}>
            <strong>AI pre-selected {candidates.filter(c => c.shortlisted).length} candidates</strong> based on vector similarity to the JD.
            You can add or remove candidates below before approving.
          </p>
        </div>

        {/* Search Bar */}
        <div className="relative mb-4 px-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: "var(--faint)" }} />
          <input
            type="text"
            placeholder="Search by name or roll number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-glass w-full py-2 pl-9 pr-4 text-sm"
          />
        </div>

        {/* Candidate list */}
        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {filteredCandidates.map((c) => (
            <div
              key={c.student_id}
              className="rounded-xl border transition-all"
              style={
                selected.has(c.student_id)
                  ? { borderColor: "var(--jade-mid)", background: "var(--wash)" }
                  : { borderColor: "var(--line)", background: "var(--card)" }
              }
            >
              <div className="flex items-center gap-3 p-3">
                {/* Checkbox */}
                <button
                  onClick={() => toggle(c.student_id)}
                  className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all"
                  style={
                    selected.has(c.student_id)
                      ? { background: "var(--jade)", borderColor: "var(--jade)" }
                      : { border: "1px solid var(--line)", background: "transparent" }
                  }
                >
                  {selected.has(c.student_id) && <Check size={12} className="text-white" />}
                </button>

                {/* Rank */}
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: "var(--wash-2)", color: "var(--ash)" }}>
                  #{c.rank}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm" style={{ color: "var(--fg)" }}>{c.name}</span>
                    <span className="badge badge-gray text-[10px]">{c.branch}</span>
                  </div>
                  <div className="text-xs" style={{ color: "var(--faint)" }}>{c.roll_no} · CGPA {c.cgpa}</div>
                </div>

                {/* Score */}
                <div className="text-right mr-2">
                  <div className="font-bold text-sm" style={{ color: "var(--jade-d)" }}>{Math.round(c.score * 100)}%</div>
                  <div className="text-[10px]" style={{ color: "var(--ghost)" }}>match</div>
                </div>

                {/* Expand explanation */}
                {c.explanation?.one_liner && (
                  <button
                    onClick={() => setExpanded(expanded === c.student_id ? null : c.student_id)}
                    className="transition-colors hover:opacity-70"
                    style={{ color: "var(--faint)" }}
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
                    <div className="px-4 pb-3 pt-0 space-y-2 mt-1" style={{ borderTop: "1px solid var(--line-2)" }}>
                      {c.explanation.one_liner && (
                        <p className="text-xs italic" style={{ color: "var(--ash)" }}>&ldquo;{c.explanation.one_liner}&rdquo;</p>
                      )}
                      {c.explanation.strengths?.length ? (
                        <div>
                          <div className="text-[10px] font-semibold mb-1" style={{ color: "var(--jade-d)" }}>STRENGTHS</div>
                          {c.explanation.strengths.slice(0, 2).map((s, i) => (
                            <div key={i} className="text-xs flex gap-1.5" style={{ color: "var(--ash)" }}>
                              <span style={{ color: "var(--jade)" }}>✓</span> {s}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {c.explanation.gaps?.length ? (
                        <div>
                          <div className="text-[10px] font-semibold mb-1" style={{ color: "var(--rose)" }}>GAPS</div>
                          {c.explanation.gaps.slice(0, 2).map((g, i) => (
                            <div key={i} className="text-xs flex gap-1.5" style={{ color: "var(--ash)" }}>
                              <span style={{ color: "var(--rose)" }}>△</span> {g}
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
        <div className="flex items-center justify-between pt-4 mt-4" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="text-sm" style={{ color: "var(--ash)" }}>
            <span className="font-semibold" style={{ color: "var(--fg)" }}>{selected.size}</span> of {candidates.length} selected
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button
              onClick={approve}
              disabled={approving || selected.size === 0}
              className="btn-primary flex items-center gap-2"
            >
              {approving ? (
                <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,.3)", borderTopColor: "#fff" }} />
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

// ─── Schedule Round Modal ────────────────────────────────────────────────────

function ScheduleRoundModal({
  driveId,
  onClose,
  onScheduled,
}: {
  driveId: string;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const today = new Date();
  today.setDate(today.getDate() + 1); // default: tomorrow
  const defaultDate = today.toISOString().slice(0, 16); // "YYYY-MM-DDThh:mm"

  const [startDatetime, setStartDatetime] = useState(defaultDate);
  const [endDatetime, setEndDatetime]     = useState(
    new Date(today.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16) // +8h
  );
  const [slotDuration, setSlotDuration]   = useState(30);
  const [mode, setMode]                   = useState<"offline" | "online">("offline");
  const [venue, setVenue]                 = useState("");
  const [scheduling, setScheduling]       = useState(false);

  const handleSchedule = async () => {
    if (!startDatetime || !endDatetime) {
      toast.error("Please set both start and end date/time");
      return;
    }
    setScheduling(true);
    try {
      // Step 1: create the round
      const roundRes = await scheduleAPI.createRound({
        drive_id: driveId,
        round_no: 1,
        round_type: "technical",
        start_datetime: new Date(startDatetime).toISOString(),
        end_datetime:   new Date(endDatetime).toISOString(),
        slot_duration_min: slotDuration,
        mode,
        venue: mode === "offline" ? venue : undefined,
      });
      const roundId: string = (roundRes.data as { id: string }).id;

      // Step 2: start the scheduling agent (propose \u2192 validate \u2192 re-plan \u2192 commit)
      await scheduleAPI.runAgent(roundId);

      toast.success("Scheduling agent started \u2014 watch it in the agent dock.");
      onScheduled();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Failed to create schedule");
    } finally {
      setScheduling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card w-full max-w-lg mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-white font-bold text-lg">Create interview round</h2>
            <p className="text-white/40 text-sm mt-0.5">Set the date window — the scheduling agent proposes slots, then checks them</p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Date/time inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                Start Date &amp; Time
              </label>
              <input
                type="datetime-local"
                value={startDatetime}
                onChange={(e) => setStartDatetime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/[0.1] text-white text-sm focus:outline-none focus:border-blue-400/60"
              />
            </div>
            <div>
              <label className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                End Date &amp; Time
              </label>
              <input
                type="datetime-local"
                value={endDatetime}
                onChange={(e) => setEndDatetime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/[0.1] text-white text-sm focus:outline-none focus:border-blue-400/60"
              />
            </div>
          </div>

          {/* Slot duration */}
          <div>
            <label className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              Slot Duration (minutes)
            </label>
            <select
              value={slotDuration}
              onChange={(e) => setSlotDuration(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/[0.1] text-white text-sm focus:outline-none focus:border-blue-400/60"
            >
              {[15, 20, 30, 45, 60].map((d) => (
                <option key={d} value={d} className="bg-gray-900">{d} min</option>
              ))}
            </select>
          </div>

          {/* Mode */}
          <div>
            <label className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
              Mode
            </label>
            <div className="flex gap-2">
              {(["offline", "online"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all border ${
                    mode === m
                      ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                      : "bg-white/[0.03] border-white/[0.08] text-white/40 hover:text-white/60"
                  }`}
                >
                  {m === "offline" ? "Offline" : "Online"}
                </button>
              ))}
            </div>
          </div>

          {/* Venue (offline only) */}
          {mode === "offline" && (
            <div>
              <label className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1.5 block">
                Venue / Room (optional)
              </label>
              <input
                type="text"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g. Seminar Hall A"
                className="w-full px-3 py-2 rounded-xl bg-white/[0.06] border border-white/[0.1] text-white text-sm placeholder-white/20 focus:outline-none focus:border-blue-400/60"
              />
            </div>
          )}

          {/* Info box */}
          <div className="bg-blue-500/[0.08] border border-blue-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
            <Zap size={15} className="text-blue-400 flex-shrink-0 mt-0.5" />
            <p className="text-blue-300/80 text-xs">
              The agent proposes an allocation of rooms and panel members, then validates it
              against every slot already committed across all other drives and rounds. If it
              finds a clash, it re-plans and re-checks before committing. You&apos;ll review the
              result before students are notified.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-5 mt-5 border-t border-white/[0.06]">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={handleSchedule}
            disabled={scheduling}
            className="btn-primary flex items-center gap-2"
          >
            {scheduling ? (
              <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Scheduling…</>
            ) : (
              <><Calendar size={15} /> Start the scheduling agent</>
            )}
          </button>
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
  onCreateRound,
  onConfirmSchedule,
  onViewSchedule,
  onArchive,
  onDelete,
  liveEvents,
}: {
  drive: Drive;
  onRunPipeline: (id: string) => void;
  onReviewShortlist: (id: string) => void;
  onCreateRound: (id: string) => void;
  onConfirmSchedule: (id: string) => void;
  onViewSchedule: (id: string) => void;
  onArchive: (id: string, title: string) => void;
  onDelete: (id: string, title: string) => void;
  liveEvents: AgentEvent[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [fetchedEvents, setFetchedEvents] = useState<AgentEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // The DB status only jumps twice (draft → jd_analyzed → shortlist_pending) —
  // the whole JD/eligibility/matching run hides behind one static "jd_analyzed" value.
  // Use the live WS event stream to show which of those 3 steps is actually active right now.
  const EVENT_TO_STEP: Record<string, string> = {
    pipeline_started:   "jd_analyzed",
    jd_analyzed:        "jd_analyzed",
    eligibility_checked: "eligibility_checked",
    matching_complete:  "matched",
  };
  const latestStepEvent = liveEvents.find((e) => EVENT_TO_STEP[e.event_type]);
  const liveStep = latestStepEvent ? EVENT_TO_STEP[latestStepEvent.event_type] : undefined;
  const isRunning = drive.status === "jd_analyzed"; // still mid-background-run in DB terms
  const effectiveStatus =
    isRunning && liveStep && MASTER_ORDER.indexOf(liveStep) > MASTER_ORDER.indexOf(drive.status)
      ? liveStep
      : drive.status;

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

  /* An activity log reads better with one semantic colour than with a dozen
     different emoji -- what a reader needs at a glance is "done / waiting /
     failed", and the event name right beside it already says which step. */
  const EVENT_TONE: Record<string, string> = {
    pipeline_started:     "var(--blue)",
    jd_analyzed:          "var(--blue)",
    eligibility_checked:  "var(--jade)",
    matching_complete:    "var(--jade)",
    shortlist_pending:    "var(--gold)",
    shortlist_approved:   "var(--jade-d)",
    shortlist_rejected:   "var(--rose)",
    schedule_created:     "var(--blue)",
    schedule_pending:     "var(--gold)",
    schedule_approved:    "var(--jade-d)",
    schedule_rejected:    "var(--rose)",
    notifications_queued: "var(--blue)",
    pipeline_error:       "var(--rose)",
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
            <span className={`badge text-[10px] inline-flex items-center gap-1.5 ${STATUS_COLOR[effectiveStatus] ?? "badge-gray"}`}>
              {isRunning && (
                <motion.span
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  className="w-1.5 h-1.5 rounded-full bg-blue-400"
                />
              )}
              {STATUS_LABEL[effectiveStatus] ?? effectiveStatus}
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
          {/* The trace is the whole argument of this project — it gets a
              first-class entry point on every drive, not a hidden menu item. */}
          <Link
            href={`/tpo/drives/${drive.id}/agent`}
            className="text-xs font-semibold flex items-center gap-1.5 py-1.5 px-3 rounded-lg transition-colors"
            style={{ color: "var(--jade-d)", background: "var(--wash)", border: "1px solid #CBEDDD" }}
            title="Watch the agent decide each step"
          >
            <Radio size={13} /> Watch Onyx think
          </Link>
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
          {drive.status === "shortlist_approved" && (
            <button
              onClick={() => onCreateRound(drive.id)}
              className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3 !bg-blue-500/20 !border-blue-500/40 hover:!bg-blue-500/30"
            >
              <Calendar size={13} className="text-blue-400" />
              <span className="text-blue-300">Create Round &amp; Schedule</span>
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
          {(drive.status === "scheduled" || drive.status === "ongoing") && (
            <button
              onClick={() => onViewSchedule(drive.id)}
              className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3 !bg-emerald-500/20 !border-emerald-500/40 hover:!bg-emerald-500/30"
            >
              <CheckCircle size={13} className="text-emerald-400" />
              <span className="text-emerald-300">View Schedule</span>
            </button>
          )}
          {/* Archive button — available for draft and completed drives */}
          {(drive.status === "draft" || drive.status === "completed" || drive.status === "cancelled") && (
            <button
              onClick={() => onArchive(drive.id, drive.title)}
              className="text-white/20 hover:text-rose-400 transition-colors p-1.5 rounded-lg hover:bg-rose-500/10"
              title="Archive drive"
            >
              <X size={14} />
            </button>
          )}
          {/* Delete — discards the drive outright. Only before a schedule is
              confirmed; past that, real interview slots may exist and the
              server rejects this, so archive is what's offered instead. */}
          {!["scheduled", "ongoing", "completed", "cancelled"].includes(drive.status) && (
            <button
              onClick={() => onDelete(drive.id, drive.title)}
              className="text-white/20 hover:text-rose-400 transition-colors p-1.5 rounded-lg hover:bg-rose-500/10"
              title="Delete drive"
            >
              <Trash2 size={14} />
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
      <PipelineTimeline status={effectiveStatus} />

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
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px]"
                        style={{ background: EVENT_TONE[evt.event_type] ?? "var(--ghost)" }}
                      />
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
  const router = useRouter();
  const [drives, setDrives] = useState<Drive[]>([]);
  const [loading, setLoading] = useState(true);
  const [shortlistDriveId, setShortlistDriveId] = useState<string | null>(null);
  const [shortlistCandidates, setShortlistCandidates] = useState<ShortlistCandidate[]>([]);
  const [scheduleRoundDriveId, setScheduleRoundDriveId] = useState<string | null>(null);
  const [showCreateDrive, setShowCreateDrive] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; danger?: boolean; onConfirm: () => void } | null>(null);
  const [pollingActive, setPollingActive] = useState(false);
  useTPOWebSocket();
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
    try {
      await drivesAPI.runPipeline(id);
      // Flip the badge/timeline to "running" instantly instead of waiting on the next poll —
      // the backend sets this status synchronously before the (slow) AI calls even start.
      setDrives((prev) => prev.map((d) => (d.id === id ? { ...d, status: "jd_analyzed" } : d)));
      setPollingActive(true);
      toast.success("Pipeline started — agent events appear below.", { duration: 4000 });
      setTimeout(fetchDrives, 2000);
    } catch (err: unknown) {
      const msg = (err as {response?: {data?: {detail?: string}}})?.response?.data?.detail;
      toast.error(msg ?? "Failed to start pipeline");
    }
  };

  const handleDelete = (id: string, title: string) => {
    setConfirmDialog({
      title: `Delete "${title}"?`,
      message: "This discards the drive and everything the agent has done on it. Cannot be undone.",
      danger: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await drivesAPI.delete(id);
          toast.success(`"${title}" deleted`);
          fetchDrives();
        } catch (err: unknown) {
          const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          toast.error(msg ?? "Failed to delete drive");
        }
      },
    });
  };

  const handleArchive = (id: string, title: string) => {
    setConfirmDialog({
      title: `Archive "${title}"?`,
      message: "You can restore it later from the Archives tab.",
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await drivesAPI.archive(id);
          toast.success(`"${title}" archived`);
          fetchDrives();
        } catch (err: unknown) {
          const msg = (err as {response?: {data?: {detail?: string}}})?.response?.data?.detail;
          toast.error(msg ?? "Failed to archive drive");
        }
      },
    });
  };

  const activeDrives   = drives.filter((d) => d.status !== "cancelled");
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
      toast.success("Schedule confirmed — students will be notified");
      fetchDrives();
    } catch (err: unknown) {
      const msg = (err as {response?: {data?: {detail?: string}}})?.response?.data?.detail;
      toast.error(msg ?? "Failed to confirm schedule");
    }
  };


  const statsBar = {
    total:     activeDrives.length,
    active:    activeDrives.filter((d) => ["jd_analyzed", "matched", "eligibility_checked", "ongoing"].includes(d.status)).length,
    pending:   activeDrives.filter((d) => ["shortlist_pending", "schedule_pending"].includes(d.status)).length,
    completed: activeDrives.filter((d) => d.status === "completed").length,
  };

  return (
    <div className="min-h-screen bg-cosmic flex">
      <TPOSidebar />
      <div className="ml-64 flex-1 flex flex-col min-h-screen">
        <TopBar
          title="Placement Drives"
          subtitle={pollingActive
            ? "A drive is in flight — refreshing every 4s"
            : "Every drive, and what the agent has done to it"
          }
        >
          <button
            onClick={() => setShowCreateDrive(true)}
            className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3"
          >
            <Plus size={13} /> Create Drive
          </button>
        </TopBar>

        <main className="p-7 space-y-5">
          {/* Stats bar — the one that needs a person is the one that stands out */}
          <div className="grid grid-cols-4 gap-3.5">
            {[
              { label: "Total drives",  value: statsBar.total,     gold: false },
              { label: "In flight",     value: statsBar.active,    gold: false },
              { label: "Waiting on you", value: statsBar.pending,  gold: true  },
              { label: "Completed",     value: statsBar.completed, gold: false },
            ].map((stat) => (
              <div
                key={stat.label}
                className={clsx(
                  "stat-gloss py-4 px-5",
                  stat.gold && stat.value > 0 && "stat-gloss-gold"
                )}
              >
                <div
                  className="font-display text-[28px] font-bold leading-none"
                  style={{ color: stat.gold && stat.value > 0 ? "var(--gold-d)" : "var(--fg)" }}
                >
                  {stat.value}
                </div>
                <div
                  className="text-[11.5px] mt-1.5"
                  style={{ color: stat.gold && stat.value > 0 ? "#A0782F" : "var(--ash)" }}
                >
                  {stat.label}
                </div>
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
          ) : activeDrives.length === 0 ? (
            <div className="glass-card text-center py-16">
              <Briefcase size={40} className="text-white/10 mx-auto mb-3" />
              <p className="text-white/40">No drives yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeDrives.map((drive) => (
                <DriveCard
                  key={drive.id}
                  drive={drive}
                  onRunPipeline={handleRunPipeline}
                  onReviewShortlist={handleReviewShortlist}
                  onCreateRound={(id) => setScheduleRoundDriveId(id)}
                  onConfirmSchedule={handleConfirmSchedule}
                  onViewSchedule={(id) => router.push(`/tpo/schedule?drive=${id}`)}
                  onArchive={handleArchive}
                  onDelete={handleDelete}
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

      {/* Confirm dialog (delete / archive) */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          danger={confirmDialog.danger}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Create drive modal */}
      {showCreateDrive && (
        <CreateDriveModal
          onClose={() => setShowCreateDrive(false)}
          onCreated={() => {
            setShowCreateDrive(false);
            fetchDrives();
          }}
        />
      )}

      {/* Schedule round modal */}
      {scheduleRoundDriveId && (
        <ScheduleRoundModal
          driveId={scheduleRoundDriveId}
          onClose={() => setScheduleRoundDriveId(null)}
          onScheduled={() => {
            setScheduleRoundDriveId(null);
            fetchDrives();
          }}
        />
      )}
    </div>
  );
}
