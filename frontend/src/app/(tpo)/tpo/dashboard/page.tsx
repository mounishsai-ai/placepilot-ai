"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

import {
  Briefcase, Award, TrendingUp,
  Play, Zap, Search, Check, Mail,
  ShieldAlert, History, Bot, UserCheck,
} from "lucide-react";

import { formatDistanceToNow } from "date-fns";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import MetricCard from "@/components/ui/MetricCard";
import AgentEventFeed from "@/components/ui/AgentEventFeed";
import AgentOrb from "@/components/ui/AgentOrb";
import { analyticsAPI, drivesAPI, noticesAPI } from "@/lib/api";
import { useDashboardStore } from "@/lib/store";
import { useTPOWebSocket } from "@/lib/websocket";
import toast from "react-hot-toast";

const PIPELINE_STEPS = [
  "draft", "jd_analyzed", "eligibility_checked", "matched",
  "shortlist_pending", "shortlist_approved", "schedule_pending",
  "scheduled", "ongoing", "completed",
];

const STATUS_BADGE: Record<string, string> = {
  draft:               "pipeline-step pending",
  jd_analyzed:         "pipeline-step active",
  eligibility_checked: "pipeline-step active",
  matched:             "pipeline-step active",
  shortlist_pending:   "pipeline-step waiting",
  shortlist_approved:  "pipeline-step done",
  schedule_pending:    "pipeline-step waiting",
  scheduled:           "pipeline-step done",
  ongoing:             "pipeline-step active",
  completed:           "pipeline-step done",
  cancelled:           "pipeline-step pending",
};

const STATUS_LABEL: Record<string, string> = {
  draft:               "Draft",
  jd_analyzed:         "JD Analyzed",
  eligibility_checked: "Eligibility Done",
  matched:             "Candidates Ranked",
  shortlist_pending:   "⏸ Awaiting Approval",
  shortlist_approved:  "Shortlist Approved",
  schedule_pending:    "⏸ Schedule Review",
  scheduled:           "Scheduled",
  ongoing:             "Ongoing",
  completed:           "Completed",
};

// Merge WS live events + historical audit trail for the Agent Activity feed
function mergeEvents(
  wsEvents: { event_type: string; agent_name: string; drive_id?: string; payload?: Record<string, unknown>; created_at: string }[],
  auditEvents: Record<string, unknown>[]
) {
  const fromAudit = auditEvents.map((e) => ({
    event_type: e.event_type as string,
    agent_name: (e.actor === "tpo" ? "human_tpo" : e.agent_name ?? "system") as string,
    drive_id: e.drive_id as string | undefined,
    payload: { drive: e.drive_title },
    created_at: e.created_at as string,
  }));
  // WS events (live, newest) come first, then historical
  const combined = [...wsEvents, ...fromAudit];
  // Deduplicate by created_at + event_type
  const seen = new Set<string>();
  return combined.filter((e) => {
    const key = `${e.event_type}:${e.created_at}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 50);
}

export default function TPODashboard() {
  const { agentEvents } = useDashboardStore();
  useTPOWebSocket();

  const [kpis, setKpis] = useState<Record<string, unknown> | null>(null);
  const [drives, setDrives] = useState<Record<string, unknown>[]>([]);
  const [pendingDrives, setPendingDrives] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [exceptions, setExceptions] = useState<Record<string, unknown>[]>([]);
  const [exceptionsTotal, setExceptionsTotal] = useState(0);
  const [exceptionSearch, setExceptionSearch] = useState("");
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());
  const [notices, setNotices] = useState<Record<string, unknown>[]>([]);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [exceptionsLoading, setExceptionsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [dashRes, drivesRes] = await Promise.all([
        analyticsAPI.dashboard(),
        drivesAPI.list(),
      ]);
      setKpis(dashRes.data.kpis);
      setDrives(drivesRes.data);
      setPendingDrives(
        drivesRes.data.filter((d: Record<string, unknown>) =>
          ["shortlist_pending", "schedule_pending"].includes(d.status as string)
        )
      );
    } catch {
      toast.error("Failed to load dashboard data");
    } finally {
      setLoading(false);
    }

    try {
      const [excRes, auditRes, noticesRes] = await Promise.all([
        analyticsAPI.exceptions(),
        analyticsAPI.auditTrail(),
        noticesAPI.list(),
      ]);
      setExceptions(excRes.data.items);
      setExceptionsTotal(excRes.data.total);
      setAuditTrail(auditRes.data);
      setNotices(noticesRes.data);
    } catch {
      // non-fatal
    } finally {
      setExceptionsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleApproveException = async (id: string) => {
    setApprovingIds((prev) => new Set(prev).add(id));
    try {
      await analyticsAPI.approveException(id);
      toast.success("Approved — added to the shortlist");
      // The fade-out is driven by AnimatePresence noticing the item leave
      // this array, not by the approvingIds flag — that flag just disables
      // the button so a slow network can't double-submit.
      setExceptions((prev) => prev.filter((e) => e.id !== id));
      setExceptionsTotal((prev) => Math.max(0, prev - 1));
    } catch {
      toast.error("Couldn't approve — try again");
      setApprovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const filteredExceptions = exceptions.filter((exc) => {
    if (!exceptionSearch.trim()) return true;
    const q = exceptionSearch.toLowerCase();
    return (
      (exc.student_name as string ?? "").toLowerCase().includes(q) ||
      (exc.roll_no as string ?? "").toLowerCase().includes(q) ||
      (exc.company as string ?? "").toLowerCase().includes(q)
    );
  });

  const handleRunPipeline = async (driveId: string, company: string) => {
    try {
      await drivesAPI.runPipeline(driveId);
      toast.success(`Pipeline started for ${company} — check Agent Activity for live updates`);
      // Poll for updates — pipeline takes 25-65s
      setTimeout(fetchData, 5000);
      setTimeout(fetchData, 15000);
      setTimeout(fetchData, 35000);
    } catch {
      toast.error("Failed to start pipeline");
    }
  };

  // Combined feed: live WS events first, then historical from DB
  const combinedFeed = mergeEvents(agentEvents, auditTrail);

  return (
    <div className="flex min-h-screen bg-cosmic">
      <TPOSidebar />

      <div className="ml-64 flex-1 flex flex-col min-h-screen">
        <TopBar
          title="Placement Dashboard"
          subtitle="Real-time AI placement operations"
        >
          {pendingDrives.length > 0 && (
            <span
              className="inline-flex items-center gap-2 text-[12px] font-semibold px-3.5 py-1.5 rounded-full"
              style={{ background: "var(--gold-lt)", border: "1px solid var(--gold-ln)", color: "var(--gold-d)" }}
            >
              <AgentOrb size={18} waiting />
              Hey TPO, {pendingDrives.length} drive{pendingDrives.length > 1 ? "s are" : " is"} waiting for your approval!
            </span>
          )}
        </TopBar>

        <main className="flex-1 p-8 space-y-8">
          {/* ── KPI Row ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-4 gap-5">
            <MetricCard
              title="Total Drives"
              value={loading ? "—" : String((kpis as Record<string,unknown>)?.total_drives ?? 0)}
              icon={<Briefcase size={20} />}
              accentColor="blue"
              trend={5}
              delay={0}
            />
            <MetricCard
              title="Active Drives"
              value={loading ? "—" : String((kpis as Record<string,unknown>)?.active_drives ?? 0)}
              icon={<Zap size={20} />}
              accentColor="cyan"
              delay={0.08}
            />
            <MetricCard
              title="Students Placed"
              value={loading ? "—" : String((kpis as Record<string,unknown>)?.placed_students ?? 0)}
              icon={<Award size={20} />}
              trend={12}
              subtitle={`${(kpis as Record<string,unknown>)?.placement_rate_pct ?? 0}% placement rate`}
              delay={0.16}
            />
            <MetricCard
              title="Avg Package"
              value={loading ? "—" : `${(kpis as Record<string,unknown>)?.avg_package_lpa ?? 0} LPA`}
              icon={<TrendingUp size={20} />}
              accentColor="purple"
              trend={8}
              delay={0.24}
            />
          </div>


          {/* ── Pipeline Status + Agent Activity ──────────────────────── */}
          <div className="grid grid-cols-3 gap-5">
            {/* Pipeline Status — 1/3 */}
            <div className="glass-card">
              <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-4">
                Pipeline Status
              </h3>
              <div className="space-y-3">
                {[
                  { label: "Pending Approvals", value: (kpis as Record<string,unknown>)?.pending_approvals ?? 0, color: "bg-amber-400" },
                  { label: "Completed Drives",  value: (kpis as Record<string,unknown>)?.completed_drives ?? 0,  color: "bg-emerald-400" },
                  { label: "Total Students",    value: (kpis as Record<string,unknown>)?.total_students ?? 0,    color: "bg-blue-400"    },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${item.color}`} />
                      <span className="text-white/60 text-sm">{item.label}</span>
                    </div>
                    <span className="text-white font-semibold text-sm">{String(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Agent Activity — 2/3, fed from WS + historical audit trail */}
            <div className="col-span-2 glass-card">
              <div className="flex items-center gap-2.5 mb-5">
                {/* The agent's own mark, present wherever it's speaking. Goes
                    gold when a drive is sitting waiting on the TPO. */}
                <AgentOrb size={26} waiting={pendingDrives.length > 0} />
                <h2 className="text-base">Onyx activity</h2>
              </div>
              <AgentEventFeed events={combinedFeed} />
            </div>
          </div>


          {/* ── Exceptions + Audit Trail ─────────────────────────────────── */}
          <div className="grid grid-cols-5 gap-6">
            {/* Exceptions — borderline students the AI flagged for human review */}
            <div className="col-span-3 glass-card">
              {/* Jade, not gold: these are flagged for a look when convenient.
                  Gold is only for a run that has actually stopped and is blocked
                  on the TPO — spending it here would dilute the one signal. */}
              <div className="flex items-center gap-2 mb-4">
                <ShieldAlert size={16} style={{ color: "var(--jade-d)" }} />
                <h2 className="text-base"><em>Exceptions</em> — needs your review</h2>
                <span className="ml-auto badge-green badge text-[10px]">
                  {exceptionsLoading ? "…" : exceptionsTotal}
                </span>
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--ash)" }}>
                Students who just barely missed eligibility — a few tenths of CGPA,
                or one backlog over the limit. Not auto-rejected; flagged for you.
              </p>
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 mb-3"
                style={{ background: "var(--wash-2)", border: "1px solid var(--line)" }}
              >
                <Search size={13} style={{ color: "var(--faint)" }} />
                <input
                  type="text"
                  placeholder="Search name, roll no, or company..."
                  value={exceptionSearch}
                  onChange={(e) => setExceptionSearch(e.target.value)}
                  className="bg-transparent text-sm outline-none flex-1"
                  style={{ color: "var(--fg)" }}
                />
              </div>
              {exceptionsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "var(--line-2)" }} />)}
                </div>
              ) : filteredExceptions.length === 0 ? (
                <div className="text-center text-sm py-10" style={{ color: "var(--faint)" }}>
                  {exceptions.length === 0 ? "No borderline cases right now." : "No matches for that search."}
                </div>
              ) : (
                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  <AnimatePresence initial={false}>
                    {filteredExceptions.map((exc) => {
                      const id = exc.id as string;
                      const reasons = (exc.reasons as { rule: string; passed: boolean; reason: string }[]) ?? [];
                      const failedReasons = reasons.filter((r) => !r.passed);
                      const approving = approvingIds.has(id);
                      return (
                        <motion.div
                          key={id}
                          layout
                          initial={{ opacity: 1 }}
                          exit={{ opacity: 0, scale: 0.96, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                          transition={{ duration: 0.25 }}
                          className="rounded-xl p-3 overflow-hidden"
                          style={{ background: "var(--wash-2)", border: "1px solid #CBEDDD" }}
                        >
                          <div className="flex items-center justify-between mb-1 gap-2">
                            <span className="font-medium text-sm">{exc.student_name as string}</span>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <span className={`badge text-[10px] ${exc.eligible ? "badge-green" : "badge-rose"}`}>
                                {exc.eligible ? "Eligible" : "Not eligible"}
                              </span>
                              <button
                                onClick={() => handleApproveException(id)}
                                disabled={approving}
                                className="ct-mono inline-flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full transition-all disabled:opacity-50"
                                style={{ background: "var(--jade)", color: "#fff" }}
                              >
                                <Check size={11} /> {approving ? "Approving…" : "Approve"}
                              </button>
                            </div>
                          </div>
                          <div className="text-[11px] mb-1.5" style={{ color: "var(--faint)" }}>
                            {exc.roll_no as string} · {exc.company as string ?? exc.drive_title as string}
                          </div>
                          {failedReasons.map((r, i) => (
                            <div key={i} className="text-[11px]" style={{ color: "#98332E" }}>{r.reason}</div>
                          ))}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Audit Trail — every decision, AI or human, in one timeline */}
            <div className="col-span-2 glass-card">
              <div className="flex items-center gap-2 mb-5">
                <History size={16} className="text-purple-400" />
                <h2 className="text-white font-semibold text-base">Audit Trail</h2>
              </div>
              <p className="text-white/35 text-xs mb-4">
                Every AI decision and every human override, in order.
              </p>
              {exceptionsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-xl bg-white/[0.04] animate-pulse" />)}
                </div>
              ) : auditTrail.length === 0 ? (
                <div className="text-center text-white/30 text-sm py-10">
                  No activity yet.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
                  {auditTrail.map((evt) => {
                    const isHuman = evt.actor === "tpo";
                    return (
                      <div key={evt.id as string} className="flex items-start gap-2 py-1.5">
                        {isHuman
                          ? <UserCheck size={13} className="text-rose-400 mt-0.5 flex-shrink-0" />
                          : <Bot size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] font-semibold ${isHuman ? "text-rose-300" : "text-blue-300"}`}>
                              {isHuman ? "TPO" : "AI"}
                            </span>
                            <span className="text-white/60 text-xs truncate">
                              {(evt.event_type as string).replace(/_/g, " ")}
                            </span>
                          </div>
                          <div className="text-white/25 text-[10px] truncate">
                            {evt.drive_title as string ?? "—"} ·{" "}
                            {formatDistanceToNow(new Date(evt.created_at as string), { addSuffix: true })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Notices from companies ───────────────────────────────────── */}
          {/* A real, authored message from a specific HR user — not the
              auto-generated pipeline_started/pipeline_error blips in the
              Onyx activity feed above, which stay exactly as they are (the
              audit trail). This is the actual communication surface. */}
          <div className="glass-card">
            <div className="flex items-center gap-2 mb-4">
              <Mail size={16} style={{ color: "var(--jade-d)" }} />
              <h2 className="text-base">Notices <em>from companies</em></h2>
              <span className="ml-auto badge-green badge text-[10px]">
                {exceptionsLoading ? "…" : notices.length}
              </span>
            </div>
            {exceptionsLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "var(--line-2)" }} />)}
              </div>
            ) : notices.length === 0 ? (
              <div className="text-center text-sm py-10" style={{ color: "var(--faint)" }}>
                No notices yet — companies can send one from their portal.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {notices.map((n) => (
                  <div
                    key={n.id as string}
                    className="rounded-xl p-3"
                    style={{ background: "var(--wash-2)", border: "1px solid var(--line)" }}
                  >
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <span className="font-medium text-sm">{n.subject as string}</span>
                      <span className="ct-mono text-[10px] flex-shrink-0" style={{ color: "var(--faint)" }}>
                        {formatDistanceToNow(new Date(n.created_at as string), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-xs mb-1.5" style={{ color: "var(--ash)" }}>{n.message as string}</p>
                    <div className="ct-mono text-[10px]" style={{ color: "var(--jade-d)" }}>
                      {n.company as string}{n.drive_title ? ` · ${n.drive_title as string}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
