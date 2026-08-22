"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Clock, Users, CheckCircle, AlertTriangle, Plus } from "lucide-react";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import toast from "react-hot-toast";
import { scheduleAPI, drivesAPI } from "@/lib/api";

// Demo data for schedule overview when no real slots exist
const DEMO_SLOTS = [
  {
    id: "slot_001", time: "09:00 AM", date: "25 Aug 2026",
    student: "Arjun Sharma", roll: "2024CS0001", round: "Technical",
    panel: "Interviewer 3", venue: "Interview Room 2", status: "scheduled",
  },
  {
    id: "slot_002", time: "09:30 AM", date: "25 Aug 2026",
    student: "Priya Rajan", roll: "2024CS0022", round: "Technical",
    panel: "Interviewer 3", venue: "Interview Room 2", status: "scheduled",
  },
  {
    id: "slot_003", time: "10:00 AM", date: "25 Aug 2026",
    student: "Vikram Nair", roll: "2024EC0112", round: "Technical",
    panel: "Interviewer 7", venue: "Interview Room 4", status: "scheduled",
  },
  {
    id: "slot_004", time: "10:30 AM", date: "25 Aug 2026",
    student: "Anita Kumar", roll: "2024IT0184", round: "HR",
    panel: "HR Manager 1", venue: "Google Meet", status: "completed",
    result: "selected",
  },
  {
    id: "slot_005", time: "11:00 AM", date: "25 Aug 2026",
    student: "Rahul Das", roll: "2024CS0150", round: "Technical",
    panel: "Interviewer 5", venue: "Interview Room 3", status: "completed",
    result: "rejected",
  },
];

export default function SchedulePage() {
  const [slots] = useState(DEMO_SLOTS);
  const [showCreateRound, setShowCreateRound] = useState(false);
  const [driveId, setDriveId] = useState("drive_001");
  const [roundType, setRoundType] = useState("technical");
  const [slotDuration, setSlotDuration] = useState("30");
  const [creating, setCreating] = useState(false);

  const stats = {
    total: slots.length,
    completed: slots.filter((s) => s.status === "completed").length,
    selected: slots.filter((s) => s.result === "selected").length,
    upcoming: slots.filter((s) => s.status === "scheduled").length,
  };

  const handleCreateRound = async () => {
    setCreating(true);
    try {
      const res = await scheduleAPI.createRound({
        drive_id: driveId,
        round_no: 1,
        round_type: roundType,
        slot_duration_min: parseInt(slotDuration),
        mode: "offline",
      });
      toast.success("Round created! Running auto-schedule...");
      await scheduleAPI.autoSchedule(res.data.id);
      toast.success("✅ Interview slots auto-allocated via FCFS!");
      setShowCreateRound(false);
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
      <div className="flex-1 flex flex-col">
        <TopBar title="Interview Schedule" subtitle="FCFS auto-allocation · manage interview rounds" />

        <main className="p-8 max-w-5xl mx-auto w-full space-y-6">
          {/* Stats */}
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

          {/* Action bar */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCreateRound(!showCreateRound)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={15} /> Create Interview Round
            </button>
            <div className="ml-auto text-white/30 text-sm flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-400" />
              Slots auto-allocated using First-Come-First-Serve algorithm
            </div>
          </div>

          {/* Create Round panel */}
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
                  <label className="text-white/40 text-xs mb-1.5 block">Drive ID</label>
                  <input
                    value={driveId}
                    onChange={(e) => setDriveId(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 outline-none"
                  />
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
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-blue-300 text-sm">
                  🤖 <strong>FCFS Auto-Schedule:</strong> Slots will be automatically allocated to shortlisted
                  students in rank order, with conflict detection for panel members and rooms.
                </p>
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

          {/* Schedule table */}
          <div className="glass-card overflow-hidden p-0">
            <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <h3 className="text-white font-semibold">TCS Digital Drive — Interview Slots</h3>
              <span className="text-white/30 text-sm">25 Aug 2026</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {["Time", "Student", "Roll No", "Round", "Panel", "Venue", "Status"].map((h) => (
                    <th key={h} className="text-left text-white/35 font-medium text-xs uppercase tracking-wider px-5 py-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slots.map((slot, i) => (
                  <motion.tr
                    key={slot.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-5 py-3">
                      <div className="text-white font-medium">{slot.time}</div>
                      <div className="text-white/30 text-[11px]">{slot.date}</div>
                    </td>
                    <td className="px-5 py-3 text-white">{slot.student}</td>
                    <td className="px-5 py-3 text-white/50 font-mono text-xs">{slot.roll}</td>
                    <td className="px-5 py-3">
                      <span className="badge badge-blue text-[10px]">{slot.round}</span>
                    </td>
                    <td className="px-5 py-3 text-white/50 text-xs">{slot.panel}</td>
                    <td className="px-5 py-3 text-white/50 text-xs">{slot.venue}</td>
                    <td className="px-5 py-3">
                      {slot.status === "completed" ? (
                        <span className={`badge text-[10px] ${
                          slot.result === "selected" ? "badge-green" : "badge-rose"
                        }`}>
                          {slot.result === "selected" ? "✓ Selected" : "✗ Rejected"}
                        </span>
                      ) : (
                        <span className="badge badge-amber text-[10px]">Scheduled</span>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}
