"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Clock, CheckCircle, XCircle, Pause, Loader2,
  User, BookOpen, Cpu, Calendar, LogOut,
} from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { scheduleAPI } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import toast from "react-hot-toast";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

// ─── Panel Sidebar ─────────────────────────────────────────────────────────

const PANEL_NAV = [
  { href: "/panel/schedule", icon: Calendar, label: "My Schedule" },
];

function PanelSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  return (
    <aside className="sidebar flex flex-col py-6">
      <div className="px-6 mb-8">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
            <Cpu size={16} className="text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-none">PlacementAI</div>
            <div className="text-white/35 text-[10px] mt-0.5">Panel Portal</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 flex flex-col gap-1">
        {PANEL_NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href}>
              <motion.div whileHover={{ x: 2 }} className={clsx("sidebar-item", active && "active")}>
                <Icon size={18} className={active ? "text-purple-400" : ""} />
                <span className="text-sm">{label}</span>
                {active && <motion.div layoutId="panel-active" className="ml-auto w-1.5 h-1.5 rounded-full bg-purple-400" />}
              </motion.div>
            </Link>
          );
        })}
      </nav>
      <div className="px-2 mt-4 pt-4 border-t border-white/[0.06]">
        <div className="sidebar-item mb-1">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {user?.email?.[0]?.toUpperCase() ?? "P"}
          </div>
          <div className="min-w-0">
            <div className="text-white/70 text-xs truncate">{user?.email}</div>
            <div className="text-white/30 text-[10px]">Panel Member</div>
          </div>
        </div>
        <button onClick={logout} className="sidebar-item w-full text-rose-400 hover:text-rose-300 hover:bg-rose-500/[0.08]">
          <LogOut size={16} />
          <span className="text-sm">Sign out</span>
        </button>
      </div>
    </aside>
  );
}

// ─── Demo Slots (shown when no real slots from API) ────────────────────────

const DEMO_SLOTS = [
  {
    id: "slot_d01",
    student_name: "Arjun Sharma",
    student_roll: "2024CS0001",
    branch: "CSE",
    cgpa: 8.7,
    match_score: 86,
    slot_start: new Date(Date.now() + 30 * 60000).toISOString(),
    slot_end: new Date(Date.now() + 60 * 60000).toISOString(),
    room: "Interview Room 2",
    round_type: "Technical",
    result: null,
  },
  {
    id: "slot_d02",
    student_name: "Vikram Nair",
    student_roll: "2024EC0112",
    branch: "ECE",
    cgpa: 9.64,
    match_score: 91,
    slot_start: new Date(Date.now() + 75 * 60000).toISOString(),
    slot_end: new Date(Date.now() + 105 * 60000).toISOString(),
    room: "Interview Room 2",
    round_type: "Technical",
    result: null,
  },
  {
    id: "slot_d03",
    student_name: "Priya Rajan",
    student_roll: "2024IT0184",
    branch: "IT",
    cgpa: 8.61,
    match_score: 74,
    slot_start: new Date(Date.now() - 90 * 60000).toISOString(),
    slot_end: new Date(Date.now() - 60 * 60000).toISOString(),
    room: "Interview Room 3",
    round_type: "Technical",
    result: "selected",
  },
  {
    id: "slot_d04",
    student_name: "Rohan Mehta",
    student_roll: "2024CS0083",
    branch: "CSE",
    cgpa: 7.28,
    match_score: 62,
    slot_start: new Date(Date.now() - 30 * 60000).toISOString(),
    slot_end: new Date(Date.now()).toISOString(),
    room: "Interview Room 3",
    round_type: "Technical",
    result: "rejected",
  },
];

type Slot = typeof DEMO_SLOTS[number] & {
  result: string | null;
};

const RESULT_OPTS = [
  { value: "selected", label: "Select",  icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25" },
  { value: "on_hold",  label: "Hold",    icon: Pause,       color: "text-amber-400",   bg: "bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25"    },
  { value: "rejected", label: "Reject",  icon: XCircle,     color: "text-rose-400",    bg: "bg-rose-500/15 border border-rose-500/30 hover:bg-rose-500/25"        },
];

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function isUpcoming(iso: string) {
  return new Date(iso) > new Date();
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function PanelSchedulePage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);

  useEffect(() => {
    scheduleAPI.getSlots("demo_round_id")
      .then((r) => {
        const data = Array.isArray(r.data) && r.data.length > 0 ? r.data : DEMO_SLOTS;
        setSlots(data as Slot[]);
      })
      .catch(() => setSlots(DEMO_SLOTS as Slot[]))
      .finally(() => setLoading(false));
  }, []);

  const handleResult = async (slotId: string, result: string) => {
    setSaving(slotId);
    try {
      // Try API first, but skip for demo slots to prevent 404
      if (!slotId.startsWith("slot_d")) {
        await scheduleAPI.updateResult(slotId, {
          result,
          feedback: feedback[slotId] ?? "",
        });
      }
      setSlots((prev) =>
        prev.map((s) => s.id === slotId ? { ...s, result, status: "completed" } : s)
      );
      const label = RESULT_OPTS.find(r => r.value === result)?.label ?? result;
      toast.success(`✅ Marked as ${label}`);
      setActiveSlot(null);
    } catch {
      toast.error("Failed to update result");
    } finally {
      setSaving(null);
    }
  };

  const stats = {
    total: slots.length,
    completed: slots.filter(s => s.result !== null).length,
    selected: slots.filter(s => s.result === "selected").length,
    pending: slots.filter(s => s.result === null).length,
  };

  return (
    <div className="min-h-screen bg-cosmic flex">
      <PanelSidebar />
      <div className="ml-64 flex-1 flex flex-col">
        <TopBar title="My Interview Schedule" subtitle="TCS Digital Drive · Technical Round" />

        <main className="p-8 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: "Assigned",   value: stats.total,     color: "text-white" },
              { label: "Completed",  value: stats.completed, color: "text-emerald-400" },
              { label: "Selected",   value: stats.selected,  color: "text-blue-400" },
              { label: "Remaining",  value: stats.pending,   color: "text-amber-400" },
            ].map((s) => (
              <div key={s.label} className="glass-card text-center py-4">
                <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-white/40 text-xs mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Date header */}
          <div className="flex items-center gap-3">
            <Calendar size={16} className="text-white/30" />
            <span className="text-white/40 text-sm">
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </span>
          </div>

          {/* Slot list */}
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <div key={i} className="glass-card h-28 animate-pulse" />)}
            </div>
          ) : (
            <div className="space-y-4">
              {slots.map((slot, i) => {
                const upcoming = isUpcoming(slot.slot_start);
                const isActive = activeSlot === slot.id;

                return (
                  <motion.div
                    key={slot.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07 }}
                    className={`glass-card border transition-all ${
                      slot.result === "selected" ? "border-emerald-500/30 bg-emerald-500/[0.03]" :
                      slot.result === "rejected" ? "border-rose-500/20" :
                      slot.result === "on_hold"  ? "border-amber-500/30 bg-amber-500/[0.03]" :
                      upcoming ? "border-blue-500/20" : "border-white/[0.08]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-6">
                      {/* Left: time + student info */}
                      <div className="flex items-center gap-4">
                        {/* Time block */}
                        <div className={`p-3 rounded-xl flex-shrink-0 ${
                          slot.result ? "bg-white/[0.04]" : upcoming ? "bg-blue-500/15" : "bg-white/[0.04]"
                        }`}>
                          <Clock size={20} className={
                            slot.result ? "text-white/30" : upcoming ? "text-blue-400" : "text-white/30"
                          } />
                        </div>

                        <div>
                          {/* Student */}
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-white font-semibold">{slot.student_name}</span>
                            <span className="badge badge-blue text-[10px]">{slot.branch}</span>
                            {upcoming && !slot.result && (
                              <span className="badge badge-amber text-[10px] animate-pulse">Upcoming</span>
                            )}
                          </div>
                          <div className="text-white/40 text-xs">
                            Roll: {slot.student_roll} · CGPA {slot.cgpa}
                          </div>
                          <div className="flex items-center gap-3 text-white/30 text-xs mt-1">
                            <span className="flex items-center gap-1">
                              <Clock size={10} />
                              {formatTime(slot.slot_start)} – {formatTime(slot.slot_end)}
                            </span>
                            {slot.room && <span>📍 {slot.room}</span>}
                            <span className="badge badge-gray text-[9px]">{slot.round_type}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: result or actions */}
                      <div className="flex-shrink-0">
                        {slot.result ? (
                          <div className="text-right">
                            <span className={`badge text-sm ${
                              slot.result === "selected" ? "badge-green" :
                              slot.result === "rejected" ? "badge-rose" : "badge-amber"
                            }`}>
                              {slot.result === "selected" ? "✓ Selected" :
                               slot.result === "rejected" ? "✗ Rejected" : "⏸ On Hold"}
                            </span>
                          </div>
                        ) : (
                          <button
                            onClick={() => setActiveSlot(isActive ? null : slot.id)}
                            className={`text-sm font-medium px-4 py-2 rounded-xl border transition-all ${
                              isActive
                                ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                                : "bg-white/[0.04] border-white/10 text-white/50 hover:text-white hover:bg-white/[0.08]"
                            }`}
                          >
                            {isActive ? "Cancel" : "Mark Result"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded: feedback + result buttons */}
                    {isActive && !slot.result && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-4 pt-4 border-t border-white/[0.06]"
                      >
                        {/* AI match info */}
                        <div className="flex items-center gap-2 mb-3 text-xs text-white/40">
                          <Cpu size={12} className="text-blue-400" />
                          AI match score: <span className="text-blue-400 font-semibold">{slot.match_score}%</span>
                          · CGPA <span className="text-white/60">{slot.cgpa}</span>
                        </div>

                        <textarea
                          placeholder="Feedback / interview notes (optional)…"
                          rows={2}
                          className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-white/70 placeholder-white/20 text-xs outline-none resize-none mb-3 focus:border-blue-500/30"
                          value={feedback[slot.id] ?? ""}
                          onChange={(e) => setFeedback(f => ({ ...f, [slot.id]: e.target.value }))}
                        />

                        <div className="flex gap-2">
                          {RESULT_OPTS.map(({ value, label, icon: Icon, color, bg }) => (
                            <button
                              key={value}
                              onClick={() => handleResult(slot.id, value)}
                              disabled={saving === slot.id}
                              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all text-sm font-medium ${bg}`}
                            >
                              {saving === slot.id ? (
                                <Loader2 size={14} className="animate-spin text-white/40" />
                              ) : (
                                <Icon size={14} className={color} />
                              )}
                              <span className={color}>{label}</span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Summary card if all done */}
          {!loading && stats.pending === 0 && stats.total > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card border border-emerald-500/20 text-center py-8"
            >
              <CheckCircle size={36} className="text-emerald-400 mx-auto mb-3" />
              <h3 className="text-white font-semibold">All Interviews Complete!</h3>
              <p className="text-white/40 text-sm mt-1">
                {stats.selected} selected · {stats.total - stats.selected} not selected
              </p>
            </motion.div>
          )}
        </main>
      </div>
    </div>
  );
}
