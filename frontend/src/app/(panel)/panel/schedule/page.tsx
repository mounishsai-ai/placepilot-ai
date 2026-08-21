"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Clock, CheckCircle, XCircle, Pause, Loader2 } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { scheduleAPI } from "@/lib/api";
import { format } from "date-fns";
import toast from "react-hot-toast";

const RESULT_OPTS = [
  { value: "selected",  label: "Selected",  icon: CheckCircle, cls: "btn-success" },
  { value: "rejected",  label: "Rejected",  icon: XCircle,    cls: "btn-danger"  },
  { value: "on_hold",   label: "On Hold",   icon: Pause,      cls: "btn-secondary" },
];

export default function PanelSchedulePage() {
  const [slots, setSlots] = useState<Record<string, unknown>[]>([]);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Demo round ID — in production, derive from panel member's assignments
    scheduleAPI.getSlots("demo_round_id")
      .then((r) => setSlots(r.data))
      .catch(() => toast.error("No schedule loaded — check round ID"))
      .finally(() => setLoading(false));
  }, []);

  const handleResult = async (slotId: string, result: string) => {
    setSaving(slotId);
    try {
      await scheduleAPI.updateResult(slotId, { result, feedback: feedback[slotId] ?? "" });
      setSlots((prev) =>
        prev.map((s) => s.id === slotId ? { ...s, result, status: "completed" } : s)
      );
      toast.success(`Marked as ${result}`);
    } catch {
      toast.error("Failed to update result");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="min-h-screen bg-cosmic">
      <TopBar title="My Interview Schedule" subtitle="Today's panel assignments" />

      <main className="p-8 max-w-4xl mx-auto space-y-5">
        {loading ? (
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-32 rounded-2xl bg-white/[0.04] animate-pulse" />)}
          </div>
        ) : slots.length === 0 ? (
          <div className="glass-card text-center py-16">
            <div className="text-4xl mb-3">📅</div>
            <p className="text-white/40">No interviews scheduled for today</p>
          </div>
        ) : (
          slots.map((slot, i) => (
            <motion.div
              key={slot.id as string}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className={`glass-card border ${
                slot.status === "completed"
                  ? slot.result === "selected" ? "border-emerald-500/30" :
                    slot.result === "rejected" ? "border-rose-500/30" : "border-amber-500/30"
                  : "border-white/[0.08]"
              }`}
            >
              <div className="flex items-start justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-blue-500/15">
                    <Clock size={20} className="text-blue-400" />
                  </div>
                  <div>
                    <div className="text-white font-semibold">{slot.student_name as string}</div>
                    <div className="text-white/40 text-sm">Roll: {slot.student_roll as string}</div>
                    <div className="text-white/40 text-xs mt-1">
                      {format(new Date(slot.slot_start as string), "h:mm a")} –{" "}
                      {format(new Date(slot.slot_end as string), "h:mm a")}
                      {slot.room && <> · 📍 {slot.room as string}</>}
                    </div>
                  </div>
                </div>

                {slot.result ? (
                  <span className={`badge text-sm ${
                    slot.result === "selected" ? "badge-green" :
                    slot.result === "rejected" ? "badge-rose" : "badge-amber"
                  }`}>
                    {slot.result as string}
                  </span>
                ) : (
                  <div className="flex flex-col gap-2 min-w-[220px]">
                    <textarea
                      placeholder="Feedback (optional)…"
                      rows={2}
                      className="input-glass text-xs"
                      value={feedback[slot.id as string] ?? ""}
                      onChange={(e) =>
                        setFeedback((f) => ({ ...f, [slot.id as string]: e.target.value }))
                      }
                    />
                    <div className="flex gap-2">
                      {RESULT_OPTS.map(({ value, label, icon: Icon, cls }) => (
                        <button
                          key={value}
                          onClick={() => handleResult(slot.id as string, value)}
                          disabled={saving === slot.id}
                          className={`${cls} flex-1 flex items-center justify-center gap-1.5 py-2 text-xs`}
                        >
                          {saving === slot.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Icon size={12} />
                          }
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ))
        )}
      </main>
    </div>
  );
}
