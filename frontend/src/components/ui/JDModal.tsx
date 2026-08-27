"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, FileText, GraduationCap, Code2, Briefcase, IndianRupee } from "lucide-react";
import { drivesAPI } from "@/lib/api";
import AgentOrb from "./AgentOrb";

/* The job description as the agent read it.

   Deliberately NOT the raw JD paragraph the company pasted in. What matters
   to a student is what the agent *extracted* — because those are the fields
   it then matched them against. Showing the structured version makes the
   eligibility decision legible: "7.0 CGPA, CSE/IT" is why you are or aren't
   on the list.

   The raw text stays available underneath for anyone who wants to check the
   extraction against the source. */

interface JDParsed {
  role?: string;
  min_cgpa?: number;
  allowed_branches?: string[];
  skills?: string[];
  package_lpa?: number;
  experience?: string;
  responsibilities?: string[];
  [k: string]: unknown;
}

interface DriveDetail {
  title?: string;
  company?: string;
  jd_text?: string;
  jd_parsed?: JDParsed | null;
}

export default function JDModal({
  driveId,
  onClose,
}: {
  driveId: string;
  onClose: () => void;
}) {
  const [drive, setDrive] = useState<DriveDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let alive = true;
    drivesAPI
      .get(driveId)
      .then((r) => alive && setDrive(r.data))
      .catch(() => alive && setDrive(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [driveId]);

  // Escape closes, like every other dismissible surface in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const jd = drive?.jd_parsed ?? null;

  const facts: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (jd?.role) facts.push({ icon: <Briefcase size={14} />, label: "Role", value: jd.role });
  if (typeof jd?.min_cgpa === "number" && jd.min_cgpa > 0)
    facts.push({ icon: <GraduationCap size={14} />, label: "Minimum CGPA", value: String(jd.min_cgpa) });
  if (typeof jd?.package_lpa === "number" && jd.package_lpa > 0)
    facts.push({ icon: <IndianRupee size={14} />, label: "Package", value: `${jd.package_lpa} LPA` });
  if (jd?.experience) facts.push({ icon: <FileText size={14} />, label: "Experience", value: String(jd.experience) });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(4,18,13,.42)", backdropFilter: "blur(3px)" }}
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white overflow-hidden"
          style={{ border: "1px solid var(--line)", boxShadow: "0 24px 70px rgba(4,18,13,.30)" }}
        >
          {/* Header */}
          <div
            className="flex items-start gap-3 px-6 py-5 shrink-0"
            style={{ borderBottom: "1px solid var(--line-2)" }}
          >
            <AgentOrb size={30} still />
            <div className="min-w-0 flex-1">
              <div className="font-display font-bold text-[16px] leading-tight" style={{ color: "var(--fg)" }}>
                {drive?.company ?? "Job description"}
              </div>
              <div className="text-[12px] mt-0.5" style={{ color: "var(--ash)" }}>
                {drive?.title ?? "…"} — <span style={{ color: "var(--jade-d)" }}>as the agent read it</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg shrink-0 transition-colors"
              style={{ color: "var(--faint)" }}
              aria-label="Close"
            >
              <X size={17} />
            </button>
          </div>

          {/* Body */}
          <div className="overflow-y-auto px-6 py-5 space-y-6">
            {loading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "var(--wash-2)" }} />
                ))}
              </div>
            ) : !jd ? (
              <p className="text-[13px] py-6 text-center" style={{ color: "var(--ash)" }}>
                The agent hasn&apos;t parsed this job description yet.
              </p>
            ) : (
              <>
                {facts.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {facts.map((f) => (
                      <div key={f.label} className="stat-gloss px-4 py-3">
                        <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider" style={{ color: "var(--faint)" }}>
                          {f.icon} {f.label}
                        </div>
                        <div className="font-display font-bold text-[17px] mt-1" style={{ color: "var(--fg)" }}>
                          {f.value}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {Array.isArray(jd.allowed_branches) && jd.allowed_branches.length > 0 && (
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider mb-2.5" style={{ color: "var(--faint)" }}>
                      Eligible branches
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {jd.allowed_branches.map((b) => (
                        <span
                          key={b}
                          className="px-2.5 py-1 rounded-lg text-[12px] font-medium"
                          style={{ background: "var(--wash)", color: "var(--jade-d)", border: "1px solid #CBEDDD" }}
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {Array.isArray(jd.skills) && jd.skills.length > 0 && (
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider mb-2.5 flex items-center gap-1.5" style={{ color: "var(--faint)" }}>
                      <Code2 size={12} /> Skills the agent matched you against
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {jd.skills.map((s) => (
                        <span
                          key={s}
                          className="px-2.5 py-1 rounded-lg text-[12px]"
                          style={{ background: "var(--wash-2)", color: "var(--fg)", border: "1px solid var(--line)" }}
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {Array.isArray(jd.responsibilities) && jd.responsibilities.length > 0 && (
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider mb-2.5" style={{ color: "var(--faint)" }}>
                      Responsibilities
                    </h3>
                    <ul className="space-y-1.5">
                      {jd.responsibilities.map((r, i) => (
                        <li key={i} className="text-[13px] leading-relaxed flex gap-2" style={{ color: "var(--fg)" }}>
                          <span style={{ color: "var(--jade)" }}>·</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}

            {drive?.jd_text && (
              <section style={{ borderTop: "1px solid var(--line-2)" }} className="pt-4">
                <button
                  onClick={() => setShowRaw((v) => !v)}
                  className="text-[12px] font-semibold"
                  style={{ color: "var(--jade-d)" }}
                >
                  {showRaw ? "Hide" : "Show"} the original text the company posted
                </button>
                {showRaw && (
                  <pre
                    className="mt-3 text-[12px] leading-relaxed whitespace-pre-wrap rounded-xl p-4"
                    style={{ background: "var(--wash-2)", color: "var(--ash)", border: "1px solid var(--line)" }}
                  >
                    {drive.jd_text}
                  </pre>
                )}
              </section>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
