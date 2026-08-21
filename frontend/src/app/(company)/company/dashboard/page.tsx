"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Upload, FileText, CheckCircle, Loader2 } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { drivesAPI } from "@/lib/api";
import toast from "react-hot-toast";

export default function CompanyDashboard() {
  const [jdText, setJdText] = useState("");
  const [parsedJD, setParsedJD] = useState<Record<string, unknown> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [driveId, setDriveId] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!jdText.trim()) { toast.error("Paste a JD first"); return; }
    setAnalyzing(true);
    try {
      // Create drive + run analysis
      const createRes = await drivesAPI.create({
        company_id: "company_001",
        title: "New Drive",
        jd_text: jdText,
      });
      const id = createRes.data.id;
      setDriveId(id);
      await drivesAPI.runPipeline(id);
      toast.success("JD analyzed! Pipeline started.");
      // Poll for parsed JD
      setTimeout(async () => {
        const res = await drivesAPI.get(id);
        if (res.data.jd_parsed) setParsedJD(res.data.jd_parsed);
      }, 4000);
    } catch {
      toast.error("Failed to analyze JD");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-cosmic">
      <TopBar title="Company Portal" subtitle="Upload JD · Review Shortlist · Confirm Schedule" />

      <main className="p-8 max-w-5xl mx-auto space-y-8">
        {/* JD Upload */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card"
        >
          <div className="flex items-center gap-3 mb-6">
            <FileText size={20} className="text-blue-400" />
            <h2 className="text-white font-semibold text-lg">Job Description Upload</h2>
          </div>

          <textarea
            id="jd-textarea"
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste your full job description here…&#10;&#10;Include: Role, package, CGPA cutoff, allowed branches, required skills, selection process…"
            rows={12}
            className="input-glass resize-none font-mono text-sm"
          />

          <div className="flex items-center gap-4 mt-4">
            <motion.button
              id="analyze-btn"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleAnalyze}
              disabled={analyzing}
              className="btn-primary flex items-center gap-2"
            >
              {analyzing
                ? <><Loader2 size={16} className="animate-spin" /> Analyzing with Gemini…</>
                : <><Upload size={16} /> Analyze JD with AI</>
              }
            </motion.button>
            <span className="text-white/30 text-sm">or drag & drop a PDF</span>
          </div>
        </motion.div>

        {/* Parsed JD Preview */}
        {parsedJD && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card border border-emerald-500/25"
          >
            <div className="flex items-center gap-3 mb-6">
              <CheckCircle size={20} className="text-emerald-400" />
              <h2 className="text-white font-semibold text-lg">AI Extracted — Review & Confirm</h2>
            </div>

            <div className="grid grid-cols-3 gap-6">
              {[
                { label: "Role",              value: parsedJD.role },
                { label: "Package",           value: parsedJD.package_lpa ? `${parsedJD.package_lpa} LPA` : "—" },
                { label: "Min CGPA",          value: parsedJD.min_cgpa },
                { label: "Max Backlogs",      value: parsedJD.max_backlogs ?? 0 },
                { label: "Work Mode",         value: parsedJD.work_mode },
                { label: "Bond",              value: parsedJD.bond_years ? `${parsedJD.bond_years} yrs` : "None" },
              ].map((field) => (
                <div key={field.label}>
                  <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-1">
                    {field.label}
                  </label>
                  <div className="text-white font-medium">{String(field.value ?? "—")}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-6">
              <div>
                <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-2">
                  Required Skills
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {((parsedJD.required_skills as string[]) ?? []).map((s) => (
                    <span key={s} className="badge-blue badge text-xs">{s}</span>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-white/40 text-xs font-semibold uppercase tracking-wider block mb-2">
                  Allowed Branches
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {((parsedJD.allowed_branches as string[]) ?? []).map((b) => (
                    <span key={b} className="badge-purple badge text-xs">{b}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button className="btn-success flex items-center gap-2">
                <CheckCircle size={15} /> Confirm & Run Pipeline
              </button>
              <button className="btn-secondary text-sm">Edit Fields</button>
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
