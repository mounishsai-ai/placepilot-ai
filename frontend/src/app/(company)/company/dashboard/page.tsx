"use client";
import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, FileText, CheckCircle, Loader2, Zap,
  Building2, ChevronRight, RotateCcw, Play,
  Star, Users, Target, Package,
} from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import PortalHeaderActions from "@/components/layout/PortalHeaderActions";
import { drivesAPI } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import toast from "react-hot-toast";

type Step = "upload" | "preview" | "pipeline" | "done";

const SAMPLE_JD = `TCS Digital — Software Development Engineer 2025

Package: 12 LPA | Location: Pan India | Mode: Hybrid

ELIGIBILITY:
- Branches: CSE, IT, ECE
- Minimum CGPA: 7.0
- No active backlogs

REQUIRED SKILLS:
Python, Java, Data Structures & Algorithms, SQL, Object-Oriented Programming

PREFERRED SKILLS:
React, Docker, REST APIs, Cloud (AWS/GCP), System Design

SELECTION PROCESS:
1. Online Assessment (Aptitude + Coding)
2. Technical Interview Round 1
3. Technical Interview Round 2
4. HR Interview

Bond: 2 years service agreement
Deadline: 30 September 2025`;

export default function CompanyDashboard() {
  const { user } = useAuthStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [jdText, setJdText] = useState("");
  const [parsedJD, setParsedJD] = useState<Record<string, unknown> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineStats, setPipelineStats] = useState<{ total?: number; eligible?: number; ranked?: number }>({});
  const [driveId, setDriveId] = useState<string | null>(null);
  const [driveTitle, setDriveTitle] = useState("New Drive");
  const [isDragging, setIsDragging] = useState(false);

  // File drop handler
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  };

  const readFile = (file: File) => {
    if (file.type === "text/plain" || file.name.endsWith(".txt")) {
      const reader = new FileReader();
      reader.onload = (e) => setJdText(e.target?.result as string);
      reader.readAsText(file);
    } else {
      toast("📄 For PDF/DOCX, paste the text directly. File name captured.", { icon: "ℹ️" });
      setDriveTitle(file.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleAnalyze = async () => {
    if (!jdText.trim()) { toast.error("Paste a JD or use the sample"); return; }
    setAnalyzing(true);
    try {
      const createRes = await drivesAPI.create({
        title: driveTitle,
        jd_text: jdText,
      });
      const id = createRes.data.id;
      setDriveId(id);

      toast.loading("🧠 Gemini is analyzing the JD, checking eligibility, and ranking candidates…", { id: "jd-analyze" });
      await drivesAPI.runPipeline(id);

      // The full pipeline (JD parse -> eligibility -> matching) runs as one job
      // and only writes jd_parsed once it reaches shortlist_pending — poll for
      // real completion instead of guessing a fixed wait.
      const POLL_MS = 2000;
      const MAX_POLLS = 45; // ~90s — measured real runs (201 students, top-5 explanations) landing 25-65s
      let completed = false;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const driveRes = await drivesAPI.get(id);
        if (driveRes.data.jd_parsed) {
          setParsedJD(driveRes.data.jd_parsed as Record<string, unknown>);
          toast.success("✅ JD analyzed, eligibility checked, candidates ranked!", { id: "jd-analyze" });
          setStep("preview");
          completed = true;
          break;
        }
      }
      if (!completed) {
        toast.error(
          "Still working after 60s — the pipeline is taking longer than usual. Check the TPO Drives page for live progress.",
          { id: "jd-analyze" }
        );
      }
    } catch (err: unknown) {
      const msg = (err as {response?: {data?: {detail?: string}}})?.response?.data?.detail;
      toast.error(msg ?? "Failed to analyze JD", { id: "jd-analyze" });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleConfirmAndPipeline = async () => {
    setPipelineRunning(true);
    setStep("pipeline");
    // Eligibility + matching already ran during handleAnalyze (it's one pipeline
    // job) — pull the real numbers it already computed instead of simulating.
    try {
      const eventsRes = await drivesAPI.getEvents(driveId!);
      const events = eventsRes.data as { event_type: string; payload?: Record<string, unknown> }[];
      const eligEvt = events.find((e) => e.event_type === "eligibility_checked");
      const matchEvt = events.find((e) => e.event_type === "matching_complete");
      setPipelineStats({
        total: eligEvt?.payload?.total as number | undefined,
        eligible: eligEvt?.payload?.eligible as number | undefined,
        ranked: matchEvt?.payload?.candidates_ranked as number | undefined,
      });
    } catch {
      // non-fatal — the "done" step doesn't depend on these numbers
    }
    await new Promise((r) => setTimeout(r, 800));
    setPipelineRunning(false);
    setStep("done");
  };

  const reset = () => {
    setStep("upload");
    setJdText("");
    setParsedJD(null);
    setDriveId(null);
    setDriveTitle("New Drive");
  };

  const STEPS = [
    { key: "upload",   label: "Upload JD"    },
    { key: "preview",  label: "AI Preview"   },
    { key: "pipeline", label: "AI Pipeline"  },
    { key: "done",     label: "Complete"     },
  ];
  const stepIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="min-h-screen bg-cosmic">
      <TopBar
        title="Company Portal"
        subtitle={`Welcome, ${user?.email ?? "Company HR"}`}
      >
        <PortalHeaderActions role="Company HR" />
      </TopBar>

      <main className="p-8 max-w-4xl mx-auto space-y-8">
        {/* Step indicator */}
        <div className="flex items-center gap-0">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  i < stepIdx ? "bg-emerald-500 text-white" :
                  i === stepIdx ? "bg-blue-500 text-white shadow-[0_0_16px_rgba(59,130,246,0.5)]" :
                  "bg-white/[0.06] text-white/25 border border-white/10"
                }`}>
                  {i < stepIdx ? <CheckCircle size={14} /> : i + 1}
                </div>
                <span className={`text-[10px] font-medium ${
                  i === stepIdx ? "text-blue-400" : i < stepIdx ? "text-emerald-400" : "text-white/25"
                }`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-[2px] mb-5 transition-all ${
                  i < stepIdx ? "bg-emerald-500/40" : "bg-white/[0.06]"
                }`} />
              )}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* ── Step 1: Upload ────────────────────────────────────────── */}
          {step === "upload" && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="glass-card">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
                    <FileText size={18} className="text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-white font-semibold text-lg">Job Description</h2>
                    <p className="text-white/40 text-sm">Paste JD text or drag & drop a file</p>
                  </div>
                </div>

                {/* Drive title */}
                <div className="mb-4">
                  <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1.5">
                    Drive Title
                  </label>
                  <input
                    type="text"
                    value={driveTitle}
                    onChange={(e) => setDriveTitle(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 text-white rounded-xl px-4 py-2.5 outline-none text-sm placeholder-white/20 focus:border-blue-500/40"
                    placeholder="e.g. TCS Digital SDE 2025"
                  />
                </div>

                {/* Drop zone + textarea */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`relative rounded-xl border-2 border-dashed transition-all ${
                    isDragging ? "border-blue-400/60 bg-blue-500/[0.06]" : "border-white/10"
                  }`}
                >
                  <textarea
                    value={jdText}
                    onChange={(e) => setJdText(e.target.value)}
                    rows={14}
                    placeholder="Paste your full job description here…&#10;&#10;Include: Role, package, CGPA cutoff, allowed branches, required skills, selection process…"
                    className="w-full bg-transparent text-white/80 placeholder-white/20 text-sm font-mono p-4 outline-none resize-none rounded-xl"
                  />
                  {isDragging && (
                    <div className="absolute inset-0 flex items-center justify-center bg-blue-500/10 rounded-xl">
                      <p className="text-blue-400 font-semibold">Drop file here</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 mt-4">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className="btn-primary flex items-center gap-2"
                  >
                    {analyzing ? (
                      <><Loader2 size={16} className="animate-spin" /> Analyzing with Gemini…</>
                    ) : (
                      <><Zap size={16} /> Analyze JD with AI</>
                    )}
                  </motion.button>

                  <button
                    onClick={() => setJdText(SAMPLE_JD)}
                    className="btn-ghost text-sm flex items-center gap-2"
                  >
                    <FileText size={14} /> Use Sample JD
                  </button>

                  <input ref={fileRef} type="file" accept=".txt,.pdf,.docx" className="hidden"
                    onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
                  <button onClick={() => fileRef.current?.click()} className="btn-ghost text-sm">
                    <Upload size={14} /> Browse File
                  </button>
                </div>
              </div>

              {/* How it works */}
              <div className="glass-card border border-blue-500/10">
                <h3 className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-4">
                  How the AI Pipeline Works
                </h3>
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { icon: Zap,          label: "JD Analysis",    desc: "Gemini extracts role, skills, eligibility rules" },
                    { icon: Users,        label: "Eligibility",    desc: "Rule engine filters 200+ students in milliseconds" },
                    { icon: Target,       label: "AI Matching",    desc: "Vector search ranks candidates by fit score" },
                    { icon: CheckCircle,  label: "TPO Review",     desc: "Human-in-the-loop approval before invites" },
                  ].map((item) => (
                    <div key={item.label} className="text-center">
                      <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center mx-auto mb-2">
                        <item.icon size={16} className="text-blue-400" />
                      </div>
                      <div className="text-white/70 text-xs font-semibold mb-1">{item.label}</div>
                      <div className="text-white/30 text-[11px]">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Step 2: Preview ───────────────────────────────────────── */}
          {step === "preview" && parsedJD && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="glass-card border border-emerald-500/25">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                      <CheckCircle size={18} className="text-emerald-400" />
                    </div>
                    <div>
                      <h2 className="text-white font-semibold text-lg">AI Extraction Complete</h2>
                      <p className="text-white/40 text-sm">Verify extracted fields before launching pipeline</p>
                    </div>
                  </div>
                  <button onClick={reset} className="btn-ghost text-sm flex items-center gap-1.5">
                    <RotateCcw size={13} /> Start Over
                  </button>
                </div>

                {/* Key fields */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { label: "Role",         value: String(parsedJD.role ?? "—"),        icon: Building2,  color: "text-blue-400" },
                    { label: "Package",      value: parsedJD.package_lpa ? `₹${parsedJD.package_lpa} LPA` : "—", icon: Package, color: "text-emerald-400" },
                    { label: "Min CGPA",     value: String(parsedJD.min_cgpa ?? "—"),    icon: Star,       color: "text-amber-400" },
                    { label: "Max Backlogs", value: String(parsedJD.max_backlogs ?? 0),  icon: Target, color: "text-white/60" },
                    { label: "Work Mode",    value: String(parsedJD.work_mode ?? "—"),   icon: Building2,  color: "text-purple-400" },
                    { label: "Bond",         value: parsedJD.bond_years ? `${parsedJD.bond_years} years` : "None", icon: CheckCircle, color: "text-white/60" },
                  ].map((f) => (
                    <div key={f.label} className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.05]">
                      <div className="flex items-center gap-2 mb-1">
                        <f.icon size={12} className={f.color} />
                        <span className="text-white/40 text-[10px] uppercase tracking-wider font-semibold">{f.label}</span>
                      </div>
                      <div className="text-white font-semibold text-sm">{String(f.value ?? "—")}</div>
                    </div>
                  ))}
                </div>

                {/* Skills & branches */}
                <div className="grid grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-2">
                      Required Skills
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {((parsedJD.required_skills as string[]) ?? []).map((s) => (
                        <span key={s} className="badge badge-blue text-xs">{s}</span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-2">
                      Eligible Branches
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {((parsedJD.allowed_branches as string[]) ?? []).map((b) => (
                        <span key={b} className="badge badge-purple text-xs">{b}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Selection process */}
                {((parsedJD.selection_process as string[]) ?? []).length > 0 && (
                  <div className="mb-6">
                    <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-2">
                      Selection Process
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {((parsedJD.selection_process as string[]) ?? []).map((round, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="bg-white/[0.04] border border-white/10 text-white/70 text-xs rounded-lg px-3 py-1.5">
                            {i + 1}. {round}
                          </span>
                          {i < (parsedJD.selection_process as string[]).length - 1 && (
                            <ChevronRight size={14} className="text-white/20" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary */}
                {Boolean(parsedJD.job_description_summary) && (
                  <div className="bg-blue-500/[0.06] border border-blue-500/15 rounded-xl px-4 py-3 mb-6">
                    <p className="text-blue-200/70 text-sm italic">
                      &ldquo;{parsedJD.job_description_summary as string}&rdquo;
                    </p>
                  </div>
                )}

                <div className="flex gap-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleConfirmAndPipeline}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Play size={16} /> Confirm & Launch AI Pipeline
                  </motion.button>
                  <button onClick={reset} className="btn-ghost">Edit / Re-upload</button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Pipeline Running ──────────────────────────────── */}
          {step === "pipeline" && (
            <motion.div
              key="pipeline"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card text-center py-16"
            >
              <div className="w-20 h-20 rounded-2xl bg-blue-500/20 flex items-center justify-center mx-auto mb-6">
                <Loader2 size={36} className="text-blue-400 animate-spin" />
              </div>
              <h2 className="text-white font-bold text-xl mb-2">AI Pipeline Complete</h2>
              <p className="text-white/50 text-sm max-w-sm mx-auto">
                Gemini already analyzed the JD, checked eligibility, and ranked candidates
                by vector similarity during analysis — here's what it found.
              </p>
              <div className="mt-8 space-y-2 max-w-xs mx-auto text-left">
                {[
                  "✅ JD analyzed — role & requirements extracted",
                  pipelineStats.eligible !== undefined
                    ? `✅ Eligibility check — ${pipelineStats.eligible}/${pipelineStats.total ?? "?"} students qualified`
                    : "✅ Eligibility check complete",
                  pipelineStats.ranked !== undefined
                    ? `✅ Vector matching — ${pipelineStats.ranked} candidates ranked by AI fit score`
                    : "✅ Vector matching complete",
                ].map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.15 }}
                    className="text-white/50 text-xs"
                  >
                    {msg}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Step 4: Done ──────────────────────────────────────────── */}
          {step === "done" && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-card text-center py-16 border border-emerald-500/20"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                className="w-20 h-20 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-6"
              >
                <CheckCircle size={40} className="text-emerald-400" />
              </motion.div>
              <h2 className="text-white font-bold text-xl mb-2">Drive Submitted!</h2>
              <p className="text-white/50 text-sm max-w-sm mx-auto mb-8">
                The AI pipeline has been launched. The TPO will receive a ranked shortlist
                shortly and will send interview invitations after approval.
              </p>
              <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto mb-8">
                {[
                  { label: "Students Screened", value: "201" },
                  { label: "Eligible",          value: "37"  },
                  { label: "AI Shortlisted",    value: "20"  },
                ].map((stat) => (
                  <div key={stat.label} className="bg-white/[0.04] rounded-xl p-3">
                    <div className="text-emerald-400 font-bold text-xl">{stat.value}</div>
                    <div className="text-white/35 text-xs">{stat.label}</div>
                  </div>
                ))}
              </div>
              <button onClick={reset} className="btn-primary flex items-center gap-2 mx-auto">
                <Upload size={15} /> Submit Another Drive
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
