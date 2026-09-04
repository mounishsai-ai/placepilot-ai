"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Bell, Calendar, Zap, BookOpen, Upload, FileText, ExternalLink, Edit2, X } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import JDModal from "@/components/ui/JDModal";
import PortalHeaderActions from "@/components/layout/PortalHeaderActions";
import { studentsAPI, notificationsAPI } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { useStudentWebSocket } from "@/lib/websocket";
import { formatDistanceToNow, format } from "date-fns";
import toast from "react-hot-toast";

function ReadinessCircle({ score }: { score: number | null }) {
  const hasScore = score != null;
  const color =
    !hasScore ? "rgba(255,255,255,0.15)" :
    score >= 80 ? "#10b981" : score >= 60 ? "#4d88ff" : score >= 40 ? "#f59e0b" : "#f43f5e";
  const circumference = 2 * Math.PI * 45;
  const dashOffset = hasScore ? circumference - (score / 100) * circumference : circumference;

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
          style={{ filter: hasScore ? `drop-shadow(0 0 8px ${color})` : undefined }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-bold text-white">{hasScore ? score : "-"}</div>
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
  const [expandedNotifId, setExpandedNotifId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [skillAdvice, setSkillAdvice] = useState<string | null>(null);
  /** Drive whose parsed JD the student is reading, or null when the modal is closed. */
  const [jdDriveId, setJdDriveId] = useState<string | null>(null);
  const [skillAdviceRole, setSkillAdviceRole] = useState<string | null>(null);
  const [skillAdviceLoading, setSkillAdviceLoading] = useState(true);
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

      studentsAPI.getSkillAdvice()
        .then((res) => {
          setSkillAdvice(res.data.advice);
          setSkillAdviceRole(res.data.based_on_role);
        })
        .catch(() => setSkillAdvice("Couldn't generate skill advice right now — try again shortly."))
        .finally(() => setSkillAdviceLoading(false));
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
      await studentsAPI.uploadResume(form);
      // Re-fetch full profile so resume_url updates in UI
      const meRes = await studentsAPI.getMe();
      setProfile(meRes.data);
      toast.success("Resume uploaded");
    } catch (err: unknown) {
      const detail = (err as {response?: {data?: {detail?: string}}})?.response?.data?.detail;
      const msg = detail ?? (err as Error)?.message ?? "Upload failed";
      console.error("Resume upload error:", err);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
    }
  };

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    cgpa: "", branch: "", batch: "", backlogs_active: "", attendance_pct: "", skillsText: ""
  });
  
  const openEditModal = () => {
    const p = profile as Record<string,any> | null;
    if (!p) return;
    setEditForm({
      cgpa: p.cgpa?.toString() || "",
      branch: p.branch || "",
      batch: p.batch?.toString() || "",
      backlogs_active: p.backlogs_active?.toString() || "",
      attendance_pct: p.attendance_pct?.toString() || "",
      skillsText: (p.skills || []).map((s: any) => s.skill).join(", ")
    });
    setIsEditModalOpen(true);
  };
  
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const skills = editForm.skillsText.split(",")
        .map(s => s.trim()).filter(s => s.length > 0)
        .map(skill => ({ skill, proficiency: "intermediate", years_experience: 0 }));
        
      await studentsAPI.updateMe({
        cgpa: editForm.cgpa ? parseFloat(editForm.cgpa) : null,
        branch: editForm.branch || null,
        batch: editForm.batch ? parseInt(editForm.batch, 10) : null,
        backlogs_active: editForm.backlogs_active ? parseInt(editForm.backlogs_active, 10) : null,
        attendance_pct: editForm.attendance_pct ? parseFloat(editForm.attendance_pct) : null,
        skills: skills.length > 0 ? skills : null
      });
      
      const meRes = await studentsAPI.getMe();
      setProfile(meRes.data);
      setIsEditModalOpen(false);
      toast.success("Profile updated successfully!");
    } catch (err) {
      console.error(err);
      toast.error("Failed to update profile");
    }
  };

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  // No fake placeholder score — a student who hasn't uploaded a resume yet
  // (so nothing has been AI-scored) sees "-", not a fabricated 72.
  const readinessRaw = (profile as Record<string, unknown>)?.placement_readiness_score;
  const readiness: number | null = readinessRaw != null ? Number(readinessRaw) : null;

  return (
    <div className="min-h-screen bg-cosmic">
      <TopBar
        title={`Welcome back, ${(profile as Record<string,unknown>)?.name ?? "Student"} 👋`}
        subtitle="Your placement journey at a glance"
      >
        <PortalHeaderActions role="Student" />
      </TopBar>

      {jdDriveId && <JDModal driveId={jdDriveId} onClose={() => setJdDriveId(null)} />}

      <main className="p-8 max-w-7xl mx-auto space-y-8">
        {/* ── Hero Row ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-6">
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
              {readiness != null ? (
                <div className={`badge text-sm ${
                  readiness >= 80 ? "badge-green" :
                  readiness >= 60 ? "badge-blue" :
                  readiness >= 40 ? "badge-amber" : "badge-rose"
                }`}>
                  {readiness >= 80 ? "Highly Ready" :
                   readiness >= 60 ? "Ready" :
                   readiness >= 40 ? "Developing" : "Not Ready"}
                </div>
              ) : (
                <div className="badge badge-gray text-sm">Upload a resume to get scored</div>
              )}
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white/50 text-xs font-semibold uppercase tracking-wider">
                My Profile
              </h2>
              <button onClick={openEditModal} className="text-white/30 hover:text-white transition-colors">
                <Edit2 size={12} />
              </button>
            </div>
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
                  { label: "Active Backlogs",  value: (profile as Record<string,unknown>)?.backlogs_active },
                  { label: "Attendance",       value: (profile as Record<string,unknown>)?.attendance_pct != null ? `${(profile as Record<string,unknown>).attendance_pct}%` : null },
                ].map(item => (
                  <div key={item.label} className="flex items-start justify-between gap-3">
                    <span className="text-white/40 text-sm flex-shrink-0">{item.label}</span>
                    <span className="text-white font-semibold text-sm text-right">{item.value != null ? String(item.value) : "—"}</span>
                  </div>
                ))}

                {/* Resume upload */}
                <div className="pt-2 border-t border-white/[0.06]">
                  {(profile as Record<string,unknown>)?.resume_url ? (
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
                          <FileText size={12} />
                          <span>Resume uploaded</span>
                        </div>
                        {typeof (profile as Record<string,unknown>)?.resume_uploaded_at === "string" && (
                          <span className="text-white/30 text-[10px] pl-[18px]">
                            Updated {formatDistanceToNow(new Date((profile as Record<string,unknown>).resume_uploaded_at as string + (((profile as Record<string,unknown>).resume_uploaded_at as string).endsWith('Z') ? '' : 'Z')), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <a
                          href={(() => {
                            const p = profile as Record<string, unknown>;
                            const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
                            const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
                            const params = new URLSearchParams();
                            if (token) params.set("token", token);
                            if (p?.resume_uploaded_at) {
                              params.set("v", String(new Date(p.resume_uploaded_at as string).getTime()));
                            }
                            return `${base}${p?.resume_url as string}?${params.toString()}`;
                          })()}
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white/50 text-xs font-semibold uppercase tracking-wider">
                My Skills
              </h2>
              <button onClick={openEditModal} className="text-white/30 hover:text-white transition-colors">
                <Edit2 size={12} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {((profile as Record<string,unknown>)?.skills as Array<{skill: string; proficiency: string}> ?? []).length > 0 ? (
                ((profile as Record<string,unknown>)?.skills as Array<{skill: string; proficiency: string}> ?? [])
                  .slice(0, 12)
                  .map((sk) => (
                    <span key={sk.skill} className={`badge text-[11px] ${
                      sk.proficiency === "expert" ? "badge-green" :
                      sk.proficiency === "intermediate" ? "badge-blue" : "badge-gray"
                    }`}>
                      {sk.skill}
                    </span>
                  ))
              ) : (
                <span className="text-white/30 text-sm">—</span>
              )}
            </div>
          </motion.div>

          {/* Notifications — moved up from the bottom of the page so it's
              part of the first thing a student sees, not the last. */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="glass-card"
          >
            <div className="flex items-center gap-2 mb-4">
              <Bell size={16} className="text-amber-400" />
              <h2 className="text-white/50 text-xs font-semibold uppercase tracking-wider">
                Notifications
              </h2>
              <span className="badge-amber badge ml-auto text-[10px]">
                {notifications.filter((n) => !n.read_at).length} unread
              </span>
            </div>
            {notifications.length === 0 ? (
              <p className="text-white/30 text-xs text-center py-6">Nothing yet</p>
            ) : (
              <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
                {notifications.map((n, i) => {
                  const id = n.id as string;
                  const expanded = expandedNotifId === id;
                  return (
                    <div
                      key={id ?? i}
                      onClick={() => {
                        setExpandedNotifId(expanded ? null : id);
                        if (!n.read_at && id) {
                          notificationsAPI.markRead(id).catch(() => {});
                          setNotifications((prev) =>
                            prev.map((x) => (x.id === id ? { ...x, read_at: new Date().toISOString() } : x))
                          );
                        }
                      }}
                      className={`flex gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        n.read_at
                          ? "border-white/[0.04] bg-white/[0.02]"
                          : "border-blue-500/20 bg-blue-500/[0.04]"
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${n.read_at ? "bg-white/20" : "bg-blue-400"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-white/80 text-xs font-medium truncate">{n.subject as string}</div>
                        <div className={`text-white/35 text-[10.5px] mt-0.5 ${expanded ? "" : "line-clamp-1"}`}>
                          {n.message as string}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>

        {/* ── AI Skill Gap Advice ───────────────────────────────────────── */}
        <div className="glass-card border border-purple-500/15">
          <div className="flex items-center gap-2 mb-5">
            <BookOpen size={16} className="text-purple-400" />
            <h2 className="text-white font-semibold">AI Skill Gap Advice</h2>
            <span className="badge badge-purple ml-2 text-[10px]">Gemini Powered</span>
            {skillAdviceRole && (
              <span className="text-white/30 text-[11px] ml-auto">
                based on demand for <span className="text-white/50">{skillAdviceRole}</span>
              </span>
            )}
          </div>
          {skillAdviceLoading ? (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 bg-white/[0.06] rounded w-5/6" />
              <div className="h-3 bg-white/[0.06] rounded w-4/6" />
              <div className="h-3 bg-white/[0.06] rounded w-3/6" />
            </div>
          ) : (
            <div className="space-y-2">
              {(skillAdvice ?? "")
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line, i) => (
                  <div key={i} className="flex items-start gap-2 text-white/60 text-xs leading-relaxed">
                    <span className="text-purple-400 mt-0.5">•</span>
                    <span>{line.replace(/^[-*•]\s*/, "")}</span>
                  </div>
                ))}
            </div>
          )}
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
                    {/* The JD as the agent parsed it — i.e. the criteria this
                        student was actually judged against. Disabled rather
                        than hidden when the drive id is missing, so the row
                        doesn't change width between matches. */}
                    <button
                      onClick={() => setJdDriveId((m.drive_id as string) ?? null)}
                      disabled={!m.drive_id}
                      title="View the job description"
                      aria-label="View the job description"
                      className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
                      style={{ background: "var(--jade)", color: "#FFFFFF" }}
                    >
                      <FileText size={15} />
                    </button>
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
                      {slot.venue as string ?? "Online"} &nbsp;·&nbsp; Panel: {slot.panel_name as string ?? "TBD"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Edit Profile Modal ────────────────────────────────────────── */}
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-[#0B0C10] border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-4 border-b border-white/5 flex justify-between items-center">
                <h3 className="text-white font-semibold">Edit Profile</h3>
                <button onClick={() => setIsEditModalOpen(false)} className="text-white/40 hover:text-white">
                  <X size={16} />
                </button>
              </div>
              <form onSubmit={handleUpdateProfile} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white/40 text-[10px] uppercase mb-1">CGPA</label>
                    <input type="number" step="0.01" value={editForm.cgpa} onChange={e => setEditForm({...editForm, cgpa: e.target.value})} className="w-full bg-white/[0.02] border border-white/10 rounded p-2 text-sm text-white focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-white/40 text-[10px] uppercase mb-1">Branch</label>
                    <input type="text" value={editForm.branch} onChange={e => setEditForm({...editForm, branch: e.target.value})} className="w-full bg-white/[0.02] border border-white/10 rounded p-2 text-sm text-white focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-white/40 text-[10px] uppercase mb-1">Batch</label>
                    <input type="number" value={editForm.batch} onChange={e => setEditForm({...editForm, batch: e.target.value})} className="w-full bg-white/[0.02] border border-white/10 rounded p-2 text-sm text-white focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-white/40 text-[10px] uppercase mb-1">Active Backlogs</label>
                    <input type="number" value={editForm.backlogs_active} onChange={e => setEditForm({...editForm, backlogs_active: e.target.value})} className="w-full bg-white/[0.02] border border-white/10 rounded p-2 text-sm text-white focus:border-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-white/40 text-[10px] uppercase mb-1">Attendance %</label>
                    <input type="number" step="0.1" value={editForm.attendance_pct} onChange={e => setEditForm({...editForm, attendance_pct: e.target.value})} className="w-full bg-white/[0.02] border border-white/10 rounded p-2 text-sm text-white focus:border-blue-500 outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-white/40 text-[10px] uppercase mb-1">Skills (comma separated)</label>
                  <textarea value={editForm.skillsText} onChange={e => setEditForm({...editForm, skillsText: e.target.value})} className="w-full bg-white/[0.02] border border-white/10 rounded p-2 text-sm text-white focus:border-blue-500 outline-none h-20 resize-none" placeholder="Python, React, Docker..." />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 text-white/50 hover:text-white text-sm">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors">Save Changes</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

      </main>
    </div>
  );
}
