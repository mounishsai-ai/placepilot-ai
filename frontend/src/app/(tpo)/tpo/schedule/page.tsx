"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { motion } from "framer-motion";
import { Calendar, Clock, Users, CheckCircle, AlertTriangle, Plus, Building2, ChevronDown, ChevronUp, Archive } from "lucide-react";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { scheduleAPI, drivesAPI } from "@/lib/api";
import { useSearchParams } from "next/navigation";

interface Slot {
  id: string;
  student_name: string | null;
  student_roll: string | null;
  round_type: string | null;
  slot_start: string;
  slot_end: string;
  status: string;
  result: string | null;
  panel: string | null;
  venue: string | null;
  drive_id?: string;
  drive_title?: string;
}

interface Drive {
  id: string;
  title: string;
  company: string | null;
}

interface DriveGroup {
  driveId: string;
  driveTitle: string;
  slots: Slot[];
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** No Z suffix — Postgres needs TIMESTAMP WITHOUT TIME ZONE */
function toNaiveISO(v: string): string {
  return v.length === 16 ? v + ":00" : v;
}

function DriveScheduleCard({ group, highlight }: { group: DriveGroup; highlight: boolean }) {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight && ref.current) ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlight]);
  const upcoming  = group.slots.filter((s) => s.status !== "completed").length;
  const completed = group.slots.filter((s) => s.status === "completed").length;
  const selected  = group.slots.filter((s) => s.result === "selected").length;
  return (
    <div ref={ref} className={`glass-card overflow-hidden p-0 ${highlight ? "ring-1 ring-blue-400/40" : ""}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 border-b border-white/[0.06] flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3 text-left">
          <Building2 size={15} className="text-blue-400 flex-shrink-0" />
          <div>
            <div className="text-white font-semibold text-sm">{group.driveTitle}</div>
            <div className="text-white/35 text-xs mt-0.5">
              {group.slots.length} slots &middot; {upcoming} upcoming &middot; {completed} done &middot; {selected} selected
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="badge badge-blue text-[10px]">{group.slots.length} slots</span>
          {open ? <ChevronUp size={16} className="text-white/30" /> : <ChevronDown size={16} className="text-white/30" />}
        </div>
      </button>
      {open && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {["Time", "Student", "Roll No", "Round", "Panel", "Venue", "Status"].map((h) => (
                <th key={h} className="text-left text-white/35 font-medium text-xs uppercase tracking-wider px-5 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.slots.map((slot, i) => (
              <motion.tr
                key={slot.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i, 20) * 0.03 }}
                className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-5 py-3">
                  <div className="text-white font-medium">{format(new Date(slot.slot_start), "hh:mm a")}</div>
                  <div className="text-white/30 text-[11px]">{format(new Date(slot.slot_start), "d MMM yyyy")}</div>
                </td>
                <td className="px-5 py-3 text-white">{slot.student_name ?? "-"}</td>
                <td className="px-5 py-3 text-white/50 font-mono text-xs">{slot.student_roll ?? "-"}</td>
                <td className="px-5 py-3"><span className="badge badge-blue text-[10px] capitalize">{slot.round_type ?? "-"}</span></td>
                <td className="px-5 py-3 text-white/50 text-xs">{slot.panel ?? "-"}</td>
                <td className="px-5 py-3 text-white/50 text-xs">{slot.venue ?? "-"}</td>
                <td className="px-5 py-3">
                  {slot.status === "completed" ? (
                    <span className={`badge text-[10px] ${slot.result === "selected" ? "badge-green" : "badge-rose"}`}>
                      {slot.result === "selected" ? "Selected" : "Rejected"}
                    </span>
                  ) : (
                    <span className="badge badge-amber text-[10px]">Upcoming</span>
                  )}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={null}>
      <SchedulePageInner />
    </Suspense>
  );
}

function SchedulePageInner() {
  const searchParams = useSearchParams();
  const highlightDriveId = searchParams.get("drive") ?? "";

  const [slots, setSlots]               = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [drives, setDrives]             = useState<Drive[]>([]);
  const [filterDriveId, setFilterDriveId] = useState(highlightDriveId);
  const [scheduleTab, setScheduleTab]     = useState<"active" | "archived">("active");
  const [showCreateRound, setShowCreateRound] = useState(false);
  const [driveId, setDriveId]           = useState(highlightDriveId);
  const [roundType, setRoundType]       = useState("technical");
  const [slotDuration, setSlotDuration] = useState("30");
  const now = new Date();
  const inEightHours = new Date(now.getTime() + 8 * 3600 * 1000);
  const [startDatetime, setStartDatetime] = useState(toLocalInputValue(now));
  const [endDatetime, setEndDatetime]     = useState(toLocalInputValue(inEightHours));
  const [creating, setCreating]         = useState(false);

  const fetchSlots = useCallback(async () => {
    try {
      const res = await scheduleAPI.listSlots();
      setSlots(res.data);
    } catch {
      toast.error("Failed to load interview slots");
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
    drivesAPI.list().then((res) => {
      setDrives(res.data);
      if (highlightDriveId) {
        setDriveId(highlightDriveId);
      } else if (res.data.length > 0) {
        setDriveId(res.data[0].id);
      }
    }).catch(() => {});
  }, [fetchSlots, highlightDriveId]);

  // Group all slots by drive
  const allGroups: DriveGroup[] = (() => {
    const map = new Map<string, DriveGroup>();
    for (const slot of slots) {
      const key = slot.drive_id ?? "unknown";
      if (!map.has(key)) map.set(key, { driveId: key, driveTitle: slot.drive_title ?? "Unknown Drive", slots: [] });
      map.get(key)!.slots.push(slot);
    }
    for (const g of map.values())
      g.slots.sort((a, b) => new Date(a.slot_start).getTime() - new Date(b.slot_start).getTime());
    const groups = Array.from(map.values());
    groups.sort((a, b) => (a.driveId === highlightDriveId ? -1 : b.driveId === highlightDriveId ? 1 : 0));
    return groups;
  })();

  const visibleGroups = (() => {
    // Separate active (upcoming) vs completed slots within each group
    const active   = allGroups.map((g) => ({ ...g, slots: g.slots.filter((s) => s.status !== "completed") })).filter((g) => g.slots.length > 0);
    const archived = allGroups.map((g) => ({ ...g, slots: g.slots.filter((s) => s.status === "completed") })).filter((g) => g.slots.length > 0);
    const base = scheduleTab === "archived" ? archived : active;
    return filterDriveId ? base.filter((g) => g.driveId === filterDriveId) : base;
  })();

  const upcomingCount  = allGroups.reduce((n, g) => n + g.slots.filter((s) => s.status !== "completed").length, 0);
  const completedCount = allGroups.reduce((n, g) => n + g.slots.filter((s) => s.status === "completed").length, 0);

  const stats = {
    total: slots.length,
    completed: slots.filter((s) => s.status === "completed").length,
    selected: slots.filter((s) => s.result === "selected").length,
    upcoming: slots.filter((s) => s.status !== "completed").length,
  };

  const handleCreateRound = async () => {
    if (!driveId) {
      toast.error("Select a drive first");
      return;
    }
    setCreating(true);
    try {
      const res = await scheduleAPI.createRound({
        drive_id: driveId,
        round_no: 1,
        round_type: roundType,
        slot_duration_min: parseInt(slotDuration),
        mode: "offline",
        start_datetime: toNaiveISO(startDatetime),
        end_datetime: toNaiveISO(endDatetime),
      });
      toast.success("Round created! Running auto-schedule...");
      const scheduleRes = await scheduleAPI.autoSchedule(res.data.id);
      const { scheduled, conflicts } = scheduleRes.data;
      if (scheduled > 0) {
        toast.success(`${scheduled} interview slots auto-allocated via FCFS!`);
      } else {
        toast.error(
          conflicts?.length > 0
            ? `No slots allocated — ${conflicts.length} conflicts.`
            : "No slots allocated — does this drive have an approved shortlist yet?"
        );
      }
      setShowCreateRound(false);
      fetchSlots();
    } catch (err: unknown) {
      const msg = (err as {response?: {data?: {detail?: string}}})?.response?.data?.detail;
      toast.error(msg ?? "Failed to create schedule");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-cosmic flex">
      <TPOSidebar />
      <div className="ml-64 flex-1 flex flex-col">
        <TopBar title="Interview Schedule" subtitle="FCFS auto-allocation · manage interview rounds" />

        <main className="p-8 space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Total Slots",  value: stats.total,    icon: Calendar,     color: "text-white" },
              { label: "Completed",    value: stats.completed, icon: CheckCircle, color: "text-emerald-400" },
              { label: "Selected",     value: stats.selected,  icon: Users,       color: "text-blue-400" },
              { label: "Upcoming",     value: stats.upcoming,  icon: Clock,       color: "text-amber-400" },
            ].map((stat) => (
              <div key={stat.label} className="glass-card flex items-center gap-3 py-4">
                <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center">
                  <stat.icon size={18} className={stat.color} />
                </div>
                <div>
                  <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-white/35 text-xs">{stat.label}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setShowCreateRound(!showCreateRound)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={15} /> Create Interview Round
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-1 border-b border-white/[0.06]">
            <button
              onClick={() => setScheduleTab("active")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
                scheduleTab === "active"
                  ? "border-blue-400 text-blue-300 bg-blue-500/[0.06]"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              <Clock size={14} /> Active
              <span className="badge badge-blue text-[10px] ml-1">{upcomingCount}</span>
            </button>
            <button
              onClick={() => setScheduleTab("archived")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2 ${
                scheduleTab === "archived"
                  ? "border-emerald-400 text-emerald-300 bg-emerald-500/[0.06]"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              <Archive size={14} /> Completed
              {completedCount > 0 && (
                <span className="badge badge-green text-[10px] ml-1">{completedCount}</span>
              )}
            </button>
            {/* Drive filter */}
            <div className="flex items-center gap-2 ml-auto">
              <Building2 size={14} className="text-white/30" />
              <select
                value={filterDriveId}
                onChange={(e) => setFilterDriveId(e.target.value)}
                className="bg-white/[0.06] border border-white/[0.1] text-white text-xs rounded-lg px-3 py-1.5 outline-none"
              >
                <option value="" className="bg-gray-900">All Drives</option>
                {allGroups.map((g) => (
                  <option key={g.driveId} value={g.driveId} className="bg-gray-900">{g.driveTitle}</option>
                ))}
              </select>
              {filterDriveId && (
                <button onClick={() => setFilterDriveId("")} className="text-white/30 hover:text-white/60 text-xs">
                  Clear
                </button>
              )}
            </div>
          </div>

          {showCreateRound && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card border border-blue-500/20"
            >
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Calendar size={16} className="text-blue-400" /> Create Interview Round + Auto-Schedule
              </h3>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-white/40 text-xs mb-1.5 block">Drive</label>
                  <select
                    value={driveId}
                    onChange={(e) => setDriveId(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none"
                  >
                    {drives.length === 0 && <option value="">No drives found</option>}
                    {drives.map((d) => (
                      <option key={d.id} value={d.id}>{d.title} — {d.company ?? "Unknown"}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-white/40 text-xs mb-1.5 block">Round Type</label>
                  <select
                    value={roundType}
                    onChange={(e) => setRoundType(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none"
                  >
                    <option value="aptitude">Aptitude Test</option>
                    <option value="technical">Technical Interview</option>
                    <option value="hr">HR Interview</option>
                    <option value="gd">Group Discussion</option>
                  </select>
                </div>
                <div>
                  <label className="text-white/40 text-xs mb-1.5 block">Slot Duration (min)</label>
                  <input
                    type="number"
                    value={slotDuration}
                    onChange={(e) => setSlotDuration(e.target.value)}
                    min="15" max="120" step="15"
                    className="w-full bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none"
                  />
                </div>
                <div>
                  <label className="text-white/40 text-xs mb-1.5 block">Window Start</label>
                  <input
                    type="datetime-local"
                    value={startDatetime}
                    onChange={(e) => setStartDatetime(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none"
                  />
                </div>
                <div>
                  <label className="text-white/40 text-xs mb-1.5 block">Window End</label>
                  <input
                    type="datetime-local"
                    value={endDatetime}
                    onChange={(e) => setEndDatetime(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowCreateRound(false)} className="btn-ghost">Cancel</button>
                <button onClick={handleCreateRound} disabled={creating} className="btn-primary flex items-center gap-2">
                  {creating ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : <Calendar size={14} />}
                  Create & Auto-Schedule
                </button>
              </div>
            </motion.div>
          )}

          {loadingSlots ? (
            <div className="space-y-4">
              {[1, 2].map((i) => <div key={i} className="glass-card h-32 animate-pulse" />)}
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="glass-card text-center py-16 text-white/30 text-sm">
              No interview slots yet. Create a round above to auto-schedule shortlisted candidates.
            </div>
          ) : (
            <div className="space-y-4">
              {visibleGroups.map((group) => (
                <DriveScheduleCard
                  key={group.driveId}
                  group={group}
                  highlight={group.driveId === highlightDriveId}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}