"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { motion } from "framer-motion";
import { Calendar, Clock, Users, CheckCircle, AlertTriangle, Plus, Building2, ChevronDown, ChevronUp, Archive, NotebookPen } from "lucide-react";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import toast from "react-hot-toast";
import { format, formatDistanceToNow } from "date-fns";
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
    <div ref={ref} className="glass-card overflow-hidden p-0" style={highlight ? { boxShadow: "0 0 0 1px var(--jade-mid)" } : undefined}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 flex items-center justify-between transition-colors hover:bg-[var(--wash-2)]"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <div className="flex items-center gap-3 text-left">
          <Building2 size={15} className="flex-shrink-0" style={{ color: "var(--jade)" }} />
          <div>
            <div className="font-semibold text-sm" style={{ color: "var(--fg)" }}>{group.driveTitle}</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--faint)" }}>
              {group.slots.length} slots &middot; {upcoming} upcoming &middot; {completed} done &middot; {selected} selected
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="badge badge-blue text-[10px]">{group.slots.length} slots</span>
          {open ? <ChevronUp size={16} style={{ color: "var(--faint)" }} /> : <ChevronDown size={16} style={{ color: "var(--faint)" }} />}
        </div>
      </button>
      {open && (
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              {["Time", "Student", "Roll No", "Round", "Panel", "Venue", "Status"].map((h) => (
                <th key={h} className="text-left font-medium text-xs uppercase tracking-wider px-5 py-3" style={{ color: "var(--faint)" }}>{h}</th>
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
                className="transition-colors hover:bg-[var(--wash-2)]"
                style={{ borderBottom: "1px solid var(--line-2)" }}
              >
                <td className="px-5 py-3">
                  <div className="font-medium" style={{ color: "var(--fg)" }}>{format(new Date(slot.slot_start), "hh:mm a")}</div>
                  <div className="text-[11px]" style={{ color: "var(--faint)" }}>{format(new Date(slot.slot_start), "d MMM yyyy")}</div>
                </td>
                <td className="px-5 py-3" style={{ color: "var(--fg)" }}>{slot.student_name ?? "-"}</td>
                <td className="px-5 py-3 font-mono text-xs" style={{ color: "var(--ash)" }}>{slot.student_roll ?? "-"}</td>
                <td className="px-5 py-3"><span className="badge badge-blue text-[10px] capitalize">{slot.round_type ?? "-"}</span></td>
                <td className="px-5 py-3 text-xs" style={{ color: "var(--ash)" }}>{slot.panel ?? "-"}</td>
                <td className="px-5 py-3 text-xs" style={{ color: "var(--ash)" }}>{slot.venue ?? "-"}</td>
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
  const [panelNotes, setPanelNotes] = useState<{ id: string; panel_name: string | null; notes: string; created_at: string }[]>([]);

  useEffect(() => {
    scheduleAPI.getAllSessionNotes().then((res) => setPanelNotes(res.data)).catch(() => {});
  }, []);

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

  const windowInvalid = new Date(toNaiveISO(endDatetime)) <= new Date(toNaiveISO(startDatetime));

  const handleCreateRound = async () => {
    if (!driveId) {
      toast.error("Select a drive first");
      return;
    }
    if (windowInvalid) {
      toast.error("Window End must be after Window Start — check the date on both, not just the time");
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
      toast.success("Round created! Scheduling agent started — watch it in the agent dock.");
      await scheduleAPI.runAgent(res.data.id);
      setShowCreateRound(false);
      // The agent runs in the background (propose → validate → re-plan →
      // commit); give it a moment before refetching so a fast run's slots show up.
      setTimeout(fetchSlots, 4000);
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
        <TopBar title="Interview Schedule" subtitle="Agent-planned rounds, validated across every drive" />

        <main className="p-8 space-y-6">
          <div className="grid grid-cols-4 gap-4">
            {/* "Upcoming" was amber, which the palette reserves for the agent
                stopping to ask a person — nothing here is waiting on anyone,
                so it reads as plain ink instead. */}
            {[
              { label: "Total Slots", value: stats.total,     icon: Calendar,    fg: "var(--fg)",     tint: "rgba(11,23,20,.05)"   },
              { label: "Completed",   value: stats.completed, icon: CheckCircle, fg: "var(--jade-d)", tint: "rgba(15,169,104,.10)" },
              { label: "Selected",    value: stats.selected,  icon: Users,       fg: "var(--jade)",   tint: "rgba(18,184,114,.10)" },
              { label: "Upcoming",    value: stats.upcoming,  icon: Clock,       fg: "var(--fg)",     tint: "rgba(11,23,20,.05)"   },
            ].map((stat) => (
              <div key={stat.label} className="stat-gloss flex items-center gap-3 py-4 px-5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: stat.tint, color: stat.fg }}
                >
                  <stat.icon size={18} />
                </div>
                <div>
                  <div className="font-display text-2xl font-bold leading-none" style={{ color: stat.fg }}>
                    {stat.value}
                  </div>
                  <div className="text-[11.5px] mt-1.5" style={{ color: "var(--ash)" }}>{stat.label}</div>
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
          <div className="flex items-center gap-1" style={{ borderBottom: "1px solid var(--line)" }}>
            <button
              onClick={() => setScheduleTab("active")}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2"
              style={
                scheduleTab === "active"
                  ? { borderColor: "var(--jade)", color: "var(--jade-d)", background: "var(--wash)" }
                  : { borderColor: "transparent", color: "var(--faint)" }
              }
            >
              <Clock size={14} /> Active
              <span className="badge badge-blue text-[10px] ml-1">{upcomingCount}</span>
            </button>
            <button
              onClick={() => setScheduleTab("archived")}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors border-b-2"
              style={
                scheduleTab === "archived"
                  ? { borderColor: "var(--jade)", color: "var(--jade-d)", background: "var(--wash)" }
                  : { borderColor: "transparent", color: "var(--faint)" }
              }
            >
              <Archive size={14} /> Completed
              {completedCount > 0 && (
                <span className="badge badge-green text-[10px] ml-1">{completedCount}</span>
              )}
            </button>
            {/* Drive filter */}
            <div className="flex items-center gap-2 ml-auto">
              <Building2 size={14} style={{ color: "var(--faint)" }} />
              <select
                value={filterDriveId}
                onChange={(e) => setFilterDriveId(e.target.value)}
                className="text-xs rounded-lg px-3 py-1.5 outline-none"
                style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
              >
                <option value="">All Drives</option>
                {allGroups.map((g) => (
                  <option key={g.driveId} value={g.driveId}>{g.driveTitle}</option>
                ))}
              </select>
              {filterDriveId && (
                <button
                  onClick={() => setFilterDriveId("")}
                  className="text-xs transition-colors hover:opacity-80"
                  style={{ color: "var(--faint)" }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {showCreateRound && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card"
              style={{ border: "1px solid var(--gold-ln)" }}
            >
              <h3 className="font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--fg)" }}>
                <Calendar size={16} style={{ color: "var(--jade)" }} /> Create Interview Round
              </h3>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: "var(--ash)" }}>Drive</label>
                  <select
                    value={driveId}
                    onChange={(e) => setDriveId(e.target.value)}
                    className="w-full text-sm rounded-xl px-3 py-2 outline-none"
                    style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
                  >
                    {drives.length === 0 && <option value="">No drives found</option>}
                    {drives.map((d) => (
                      <option key={d.id} value={d.id}>{d.title} — {d.company ?? "Unknown"}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: "var(--ash)" }}>Round Type</label>
                  <select
                    value={roundType}
                    onChange={(e) => setRoundType(e.target.value)}
                    className="w-full text-sm rounded-xl px-3 py-2 outline-none"
                    style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
                  >
                    <option value="aptitude">Aptitude Test</option>
                    <option value="technical">Technical Interview</option>
                    <option value="hr">HR Interview</option>
                    <option value="gd">Group Discussion</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: "var(--ash)" }}>Slot Duration (min)</label>
                  <input
                    type="number"
                    value={slotDuration}
                    onChange={(e) => setSlotDuration(e.target.value)}
                    min="15" max="120" step="15"
                    className="w-full text-sm rounded-xl px-3 py-2 outline-none"
                    style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
                  />
                </div>
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: "var(--ash)" }}>Window Start</label>
                  <input
                    type="datetime-local"
                    value={startDatetime}
                    onChange={(e) => setStartDatetime(e.target.value)}
                    className="w-full text-sm rounded-xl px-3 py-2 outline-none"
                    style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
                  />
                </div>
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: "var(--ash)" }}>Window End</label>
                  <input
                    type="datetime-local"
                    value={endDatetime}
                    onChange={(e) => setEndDatetime(e.target.value)}
                    className="w-full text-sm rounded-xl px-3 py-2 outline-none"
                    style={{
                      background: "var(--wash-2)",
                      border: windowInvalid ? "1px solid #C2453F" : "1px solid var(--line)",
                      color: "var(--fg)",
                    }}
                  />
                  {windowInvalid && (
                    <p className="text-[11px] mt-1" style={{ color: "#C2453F" }}>
                      Ends before it starts — check the date, not just the time (an overnight window needs the next day's date here).
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowCreateRound(false)} className="btn-ghost">Cancel</button>
                <button onClick={handleCreateRound} disabled={creating || windowInvalid} className="btn-primary flex items-center gap-2 disabled:opacity-40">
                  {creating ? (
                    <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(255,255,255,.3)", borderTopColor: "#fff" }} />
                  ) : <Calendar size={14} />}
                  Create & plan the round
                </button>
              </div>
            </motion.div>
          )}

          {loadingSlots ? (
            <div className="space-y-4">
              {[1, 2].map((i) => <div key={i} className="glass-card h-32 animate-pulse" />)}
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="glass-card text-center py-16 text-sm" style={{ color: "var(--faint)" }}>
              No interview slots yet. Create a round above and the agent will plan one for the shortlisted candidates.
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

          {panelNotes.length > 0 && (
            <div className="glass-card">
              <div className="flex items-center gap-2 mb-4">
                <NotebookPen size={16} style={{ color: "var(--jade-d)" }} />
                <h2 className="text-base">Notes <em>from panel members</em></h2>
                <span className="ml-auto badge-green badge text-[10px]">{panelNotes.length}</span>
              </div>
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {panelNotes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-xl p-3"
                    style={{ background: "var(--wash-2)", border: "1px solid var(--line)" }}
                  >
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <span className="font-medium text-sm">{n.panel_name ?? "Panel member"}</span>
                      <span className="ct-mono text-[10px] flex-shrink-0" style={{ color: "var(--faint)" }}>
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: "var(--ash)" }}>{n.notes}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
