"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Bell, Calendar, Zap, BookOpen, Upload, FileText, ExternalLink } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { studentsAPI, notificationsAPI } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { useStudentWebSocket } from "@/lib/websocket";
import { formatDistanceToNow, format } from "date-fns";
import toast from "react-hot-toast";

function ReadinessCircle({ score }: { score: number }) {
  const color =
    score >= 80 ? "#10b981" : score >= 60 ? "#4d88ff" : score >= 40 ? "#f59e0b" : "#f43f5e";
  const circumference = 2 * Math.PI * 45;
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg width="144" height="144" viewBox="0 0 144 144" className="-rotate-90">
        <circle cx="72" cy="72" r="45" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
        <motion.circle
          cx="72" cy="72" r="45"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-bold text-white">{score}</div>
        <div className="text-white/40 text-[10px]">/ 100</div>
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const { user } = useAuthStore();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [schedule, setSchedule] = useState<Record<string, unknown>[]>([]);
  const [matches, setMatches] = useState<Record<string, unknown>[]>([]);
  const [notifications, setNotifications] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useStudentWebSocket(studentId);

  const fetchData = useCallback(async () => {
    try {
      // /me resolves logged-in user → Student record by email
      const meRes = await studentsAPI.getMe();
      const me = meRes.data;
      setStudentId(me.id);
      setProfile(me);
      setMatches(me.matches ?? []);

      // Fetch schedule + notifications separately using resolved student ID
      const [schedRes, notifRes] = await Promise.all([
        studentsAPI.getSchedule(me.id),
        notificationsAPI.getStudentNotifications(me.id),
      ]);
      setSchedule(schedRes.data);
      setNotifications(notifRes.data);
    } catch (err: unknown) {
      const msg = (err as {response?: {data?: {detail?: string}}})?.response?.data?.detail;
      if (msg?.includes("No student record")) {
        toast.error("Your student profile isn't set up yet. Contact the TPO.");
      } else {
        toast.error("Failed to load your profile");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleResumeUpload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await studentsAPI.uploadResume(form);
      setProfile(p => ({ ...p as Record<string, unknown>, resume_url: res.data.resume_url }));
      toast.success("✅ Resume uploaded!");
    } catch {
      toast.error("Upload failed — check file size");
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  const readiness = Number((profile as Record<string,unknown>)?.placement_readiness_score ?? 72);

  return (
    <div className="min-h-screen bg-cosmic">
      <TopBar
        title={`Welcome back, ${(profile as Record<string,unknown>)?.name ?? "Student"} 👋`}
        subtitle="Your placement journey at a glance"
      />

      <main className="p-8 max-w-7xl mx-auto space-y-8">
        {/* ── Hero Row ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-6">
          {/* Readiness score */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card flex flex-col items-center text-center"
          >
            <h2 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4">
              Placement Readiness
            </h2>
            <ReadinessCircle score={readiness} />
            <div className="mt-4">
              <div className={`badge text-sm ${
                readiness >= 80 ? "badge-green" :
                readiness >= 60 ? "badge-blue" :
                readiness >= 40 ? "badge-amber" : "badge-rose"
              }`}>
                {readiness >= 80 ? "Highly Ready" :
                 readiness >= 60 ? "Ready" :
                 readiness >= 40 ? "Developing" : "Not Ready"}
              </div>
              <p className="text-white/30 text-xs mt-2">Based on CGPA, skills & attendance</p>
            </div>
          </motion.div>

          {/* Profile quick stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card"
          >
            <h2 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4">
              My Profile
            </h2>
            {loading ? (
              <div className="space-y-3">
                {[1,2,3,4].map(i => <div key={i} className="h-6 rounded bg-white/[0.04] animate-pulse" />)}
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  { label: "CGPA",            value: (profile as Record<string,unknown>)?.cgpa       },
                  { label: "Branch",           value: (profile as Record<string,unknown>)?.branch     },
                  { label: "Batch",            value: (profile as Record<string,unknown>)?.batch      },
                  { label: "Active Backlogs",  value: (profile as Record<string,unknown>)?.backlogs_active ?? 0 },
                  { label: "Attendance",       value: `${(profile as Record<string,unknown>)?.attendance_pct ?? 0}%` },
                ].map(item => (
                  <div key={item.label} className="flex justify-between">
                    <span className="text-white/40 text-sm">{item.label}</span>
                    <span className="text-white font-semibold text-sm">{String(item.value ?? "—")}</span>
                  </div>
                ))}

                {/* Resume upload */}
                <div className="pt-2 border-t border-white/[0.06]">
                  {(profile as Record<string,unknown>)?.resume_url ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
                        <FileText size={12} />
                        <span>Resume uploaded</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={`http://localhost:8000${(profile as Record<string,unknown>)?.resume_url as string}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 text-xs flex items-center gap-1 hover:text-blue-300"
                        >
                          <ExternalLink size={11} /> View
                        </a>
                        <button onClick={() => fileRef.current?.click()} className="text-white/35 text-xs hover:text-white">
                          Replace
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-dashed border-white/20 text-white/40 text-xs hover:text-white hover:border-white/40 transition-all"
                    >
                      {uploading ? <span className="animate-pulse">Uploading…</span> : <><Upload size={12} /> Upload Resume (PDF)</>}
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.docx,.doc"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleResumeUpload(e.target.files[0])}
                  />
                </div>
              </div>
            )}
          </motion.div>

          {/* Skills */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card"
          >
            <h2 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4">
              My Skills
            </h2>
            <div className="flex flex-wrap gap-2">
              {((profile as Record<string,unknown>)?.skills as Array<{skill: string; proficiency: string}> ?? [])
                .slice(0, 12)
                .map((sk) => (
                  <span key={sk.skill} className={`badge text-[11px] ${
                    sk.proficiency === "expert" ? "badge-green" :
                    sk.proficiency === "intermediate" ? "badge-blue" : "badge-gray"
                  }`}>
                    {sk.skill}
                  </span>
                ))}
            </div>
          </motion.div>
        </div>

        {/* ── Active Drives / Matches ──────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-6">
          <div className="glass-card">
            <div className="flex items-center gap-2 mb-5">
              <Zap size={16} className="text-blue-400" />
              <h2 className="text-white font-semibold">Active Drive Matches</h2>
            </div>
            {matches.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-8">No matches yet</p>
            ) : (
              <div className="space-y-3">
                {matches.slice(0, 5).map((m, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-4 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-white/80 text-sm font-medium truncate">{m.role as string ?? "Role"}</div>
                      <div className="text-white/35 text-xs">{m.company as string ?? "Company"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-blue-400 font-bold text-sm">
                        {Math.round(Number(m.score))}%
                      </div>
                      <div className="text-white/30 text-[10px]">match</div>
                    </div>
                    <div>
                      {m.shortlisted
                        ? <span className="badge-green badge text-[10px]">✓ Shortlisted</span>
                        : <span className="badge-gray badge text-[10px]">Rank #{m.rank as number}</span>
                      }
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="glass-card">
            <div className="flex items-center gap-2 mb-5">
              <Calendar size={16} className="text-cyan-400" />
              <h2 className="text-white font-semibold">Interview Schedule</h2>
            </div>
            {schedule.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-8">No interviews scheduled yet</p>
            ) : (
              <div className="space-y-3">
                {schedule.slice(0, 4).map((slot, i) => (
                  <div key={i} className="p-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04]">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-cyan-400 font-semibold text-sm">
                        {format(new Date(slot.slot_start as string), "d MMM · h:mm a")}
                      </span>
                      <span className={`badge text-[10px] ${
                        slot.status === "completed" ? "badge-green" : "badge-blue"
                      }`}>
                        {slot.round_type as string}
                      </span>
                    </div>
                    <div className="text-white/50 text-xs">
                      📍 {slot.venue as string ?? "Online"} &nbsp;·&nbsp; Panel: {slot.panel_name as string ?? "TBD"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Notifications ────────────────────────────────────────────── */}
        <div className="glass-card">
          <div className="flex items-center gap-2 mb-5">
            <Bell size={16} className="text-amber-400" />
            <h2 className="text-white font-semibold">Recent Notifications</h2>
            <span className="badge-amber badge ml-auto text-[10px]">
              {notifications.filter((n) => !n.read_at).length} unread
            </span>
          </div>
          <div className="space-y-2">
            {notifications.slice(0, 5).map((n, i) => (
              <div
                key={i}
                className={`flex gap-4 p-4 rounded-xl border transition-colors ${
                  n.read_at
                    ? "border-white/[0.04] bg-white/[0.02]"
                    : "border-blue-500/20 bg-blue-500/[0.04]"
                }`}
              >
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.read_at ? "bg-white/20" : "bg-blue-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-white/80 text-sm font-medium">{n.subject as string}</div>
                  <div className="text-white/40 text-xs mt-0.5 line-clamp-2">{n.message as string}</div>
                </div>
                <div className="text-white/25 text-[10px] whitespace-nowrap">
                  {formatDistanceToNow(new Date(n.created_at as string), { addSuffix: true })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── AI Skill Gap Advice ───────────────────────────────────────── */}
        <div className="glass-card border border-purple-500/15">
          <div className="flex items-center gap-2 mb-5">
            <BookOpen size={16} className="text-purple-400" />
            <h2 className="text-white font-semibold">AI Skill Gap Advice</h2>
            <span className="badge badge-purple ml-2 text-[10px]">Gemini Powered</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                skill: "Data Structures & Algorithms",
                priority: "High",
                drives: 4,
                tip: "Practice LeetCode Medium problems. Focus on arrays, trees, and dynamic programming.",
                color: "border-rose-500/25 bg-rose-500/[0.04]",
                badge: "badge-rose",
              },
              {
                skill: "System Design",
                priority: "Medium",
                drives: 3,
                tip: "Read 'Designing Data-Intensive Applications'. Practice designing URL shorteners, chat systems.",
                color: "border-amber-500/25 bg-amber-500/[0.04]",
                badge: "badge-amber",
              },
              {
                skill: "Cloud (AWS/GCP)",
                priority: "Medium",
                drives: 3,
                tip: "Get AWS Cloud Practitioner certified. Hands-on with S3, EC2, Lambda basics.",
                color: "border-blue-500/25 bg-blue-500/[0.04]",
                badge: "badge-blue",
              },
            ].map((item) => (
              <div key={item.skill} className={`rounded-xl border p-4 ${item.color}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`badge text-[10px] ${item.badge}`}>{item.priority} Priority</span>
                  <span className="text-white/30 text-[10px]">{item.drives} drives require this</span>
                </div>
                <div className="text-white font-semibold text-sm mb-2">{item.skill}</div>
                <p className="text-white/45 text-xs leading-relaxed">{item.tip}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
