"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";

import {
  Briefcase, Award, TrendingUp,
  Play, Zap, X,
  ShieldAlert, History, Bot, UserCheck,
} from "lucide-react";

import { formatDistanceToNow } from "date-fns";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import MetricCard from "@/components/ui/MetricCard";
import AgentEventFeed from "@/components/ui/AgentEventFeed";
import { analyticsAPI, drivesAPI } from "@/lib/api";
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
  const { connected } = useTPOWebSocket();

  const [kpis, setKpis] = useState<Record<string, unknown> | null>(null);
  const [drives, setDrives] = useState<Record<string, unknown>[]>([]);
  const [pendingDrives, setPendingDrives] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [exceptions, setExceptions] = useState<Record<string, unknown>[]>([]);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [exceptionsLoading, setExceptionsLoading] = useState(true);
  const [alertDismissed, setAlertDismissed] = useState(false);

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
      const [excRes, auditRes] = await Promise.all([
        analyticsAPI.exceptions(),
        analyticsAPI.auditTrail(),
      ]);
      setExceptions(excRes.data);
      setAuditTrail(auditRes.data);
    } catch {
      // non-fatal
    } finally {
      setExceptionsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

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
          connected={connected}
        />

        <main className="flex-1 p-8 space-y-8">
          {/* ── Pending Approvals Banner ───────────────────────────────── */}
          {/* Gold, because gold means one thing in this app: the agent has
              stopped and needs a person. Dismissible — the drives keep waiting
              in the list either way, so this is a nudge, not a gate. */}
          {pendingDrives.length > 0 && !alertDismissed && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative rounded-xl p-4 pr-11 flex items-center gap-3.5"
              style={{ background: "var(--gold-lt)", border: "1px solid var(--gold-ln)" }}
            >
              <div
                className="w-[26px] h-[26px] rounded-lg grid place-items-center text-white text-sm font-bold flex-shrink-0"
                style={{ background: "var(--gold)" }}
              >
                !
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[13px]" style={{ color: "var(--gold-d)" }}>
                  {pendingDrives.length} drive{pendingDrives.length > 1 ? "s are" : " is"} waiting on your approval
                </p>
                <p className="ct-mono text-[10.5px] mt-0.5 truncate" style={{ color: "#A0782F" }}>
                  {pendingDrives.map((d) => d.title as string).join(" · ")}
                </p>
              </div>
              <button
                onClick={() => setAlertDismissed(true)}
                aria-label="Dismiss"
                className="absolute top-2.5 right-2.5 w-6 h-6 rounded-md grid place-items-center transition-colors"
                style={{ color: "#B08A45" }}
              >
                <X size={14} />
              </button>
            </motion.div>
          )}

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
            {/* The one bright card — the outcome the whole system exists for. */}
            <MetricCard
              title="Students Placed"
              value={loading ? "—" : String((kpis as Record<string,unknown>)?.placed_students ?? 0)}
              icon={<Award size={20} />}
              hero
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
              <div className="flex items-center gap-2 mb-5">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <h2 className="text-white font-semibold text-base">Agent Activity</h2>
                {connected && (
                  <span className="ml-auto badge-green badge text-[10px]">LIVE</span>
                )}
                {!connected && combinedFeed.length > 0 && (
                  <span className="ml-auto text-white/30 text-[10px]">historical</span>
                )}
              </div>
              <AgentEventFeed events={combinedFeed} />
            </div>
          </div>


          {/* ── Exceptions + Audit Trail ─────────────────────────────────── */}
          <div className="grid grid-cols-5 gap-6">
            {/* Exceptions — borderline students the AI flagged for human review */}
            <div className="col-span-3 glass-card">
              <div className="flex items-center gap-2 mb-5">
                <ShieldAlert size={16} className="text-amber-400" />
                <h2 className="text-white font-semibold text-base">Exceptions — Needs Your Review</h2>
                <span className="ml-auto badge-amber badge text-[10px]">
                  {exceptionsLoading ? "…" : exceptions.length}
                </span>
              </div>
              <p className="text-white/35 text-xs mb-4">
                Students who just barely missed eligibility — a few tenths of CGPA,
                or one backlog over the limit. Not auto-rejected; flagged for you.
              </p>
              {exceptionsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl bg-white/[0.04] animate-pulse" />)}
                </div>
              ) : exceptions.length === 0 ? (
                <div className="text-center text-white/30 text-sm py-10">
                  No borderline cases right now.
                </div>
              ) : (
                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {exceptions.map((exc) => {
                    const reasons = (exc.reasons as { rule: string; passed: boolean; reason: string }[]) ?? [];
                    const failedReasons = reasons.filter((r) => !r.passed);
                    return (
                      <div key={exc.id as string} className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-white font-medium text-sm">{exc.student_name as string}</span>
                          <span className={`badge text-[10px] ${exc.eligible ? "badge-green" : "badge-rose"}`}>
                            {exc.eligible ? "Eligible" : "Not eligible"}
                          </span>
                        </div>
                        <div className="text-white/35 text-[11px] mb-1.5">
                          {exc.roll_no as string} · {exc.company as string ?? exc.drive_title as string}
                        </div>
                        {failedReasons.map((r, i) => (
                          <div key={i} className="text-rose-300/70 text-[11px]">{r.reason}</div>
                        ))}
                      </div>
                    );
                  })}
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
        </main>
      </div>
    </div>
  );
}
