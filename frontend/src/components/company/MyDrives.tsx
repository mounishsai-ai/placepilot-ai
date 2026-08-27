"use client";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Users, CheckCircle2, RefreshCw, Inbox } from "lucide-react";
import AgentOrb from "@/components/ui/AgentOrb";
import { drivesAPI } from "@/lib/api";
import toast from "react-hot-toast";

/* What happened to the JD I posted?

   An HR user uploads a job description and then the process disappears into
   the college's side of the system. This is the TPO's drives view narrowed to
   one company and stripped of every control they don't own: no approve, no
   archive, no re-run. It answers one question — where did my drive get to,
   and what has the agent done about it.

   The pipeline strip is derived from drive status rather than tracked
   separately, so it can't disagree with the record. */

interface MyDrive {
  id: string;
  title: string;
  status: string;
  package_lpa: number | null;
  role: string | null;
  created_at: string | null;
  candidates_matched: number;
  candidates_shortlisted: number;
  last_agent_step: { kind: string; summary: string; agent: string } | null;
}

/* The order the drive actually moves through. Statuses that mean "the agent
   finished this stage and is waiting on the college" collapse onto the stage
   they completed — the HR user doesn't need the college's internal gates. */
const STAGES = [
  { key: "posted",      label: "Posted"       },
  { key: "read",        label: "JD read"      },
  { key: "eligible",    label: "Eligibility"  },
  { key: "shortlisted", label: "Shortlist"    },
  { key: "scheduled",   label: "Interviews"   },
  { key: "done",        label: "Complete"     },
];

const REACHED: Record<string, number> = {
  draft: 1,
  jd_analyzed: 2,
  eligibility_checked: 3,
  matched: 3,
  shortlist_pending: 4,
  shortlist_approved: 4,
  schedule_pending: 5,
  scheduled: 5,
  ongoing: 5,
  completed: 6,
};

/* Only the states where the college owes the company an answer. Everything
   else reads as ordinary progress, so this stays rare enough to mean
   something. */
const WAITING_ON_COLLEGE = new Set(["shortlist_pending", "schedule_pending"]);

export default function MyDrives() {
  const [drives, setDrives] = useState<MyDrive[]>([]);
  const [company, setCompany] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (quiet = false) => {
    try {
      const r = await drivesAPI.myCompany();
      setDrives(r.data.drives ?? []);
      setCompany(r.data.company ?? null);
    } catch {
      if (!quiet) toast.error("Couldn't load your drives");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // A drive can move while this is open — the agent runs on the college's
    // side, not from any action taken here.
    const t = setInterval(() => load(true), 8000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1].map((i) => <div key={i} className="glass-card h-36 animate-pulse" />)}
      </div>
    );
  }

  if (drives.length === 0) {
    return (
      <div className="glass-card text-center py-14">
        <Inbox size={30} className="mx-auto mb-3" style={{ color: "var(--ghost)" }} />
        <h3 className="font-display font-bold text-[15px]" style={{ color: "var(--fg)" }}>
          Nothing posted yet
        </h3>
        <p className="text-[13px] mt-1.5" style={{ color: "var(--ash)" }}>
          Upload a job description and it will show up here with its progress.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold text-[16px]" style={{ color: "var(--fg)" }}>
            {company ?? "Your"} drives
          </h2>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--ash)" }}>
            {drives.length} posted · updates as the agent works
          </p>
        </div>
        <button
          onClick={() => load()}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg"
          style={{ color: "var(--jade-d)", background: "var(--wash)", border: "1px solid #CBEDDD" }}
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {drives.map((d, i) => {
        const reached = REACHED[d.status] ?? 1;
        const waiting = WAITING_ON_COLLEGE.has(d.status);
        return (
          <motion.div
            key={d.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-display font-bold text-[15px] leading-tight" style={{ color: "var(--fg)" }}>
                  {d.role ?? d.title}
                </div>
                <div className="text-[11.5px] mt-1" style={{ color: "var(--ash)" }}>
                  {d.title}
                  {d.package_lpa ? ` · ${d.package_lpa} LPA` : ""}
                </div>
              </div>
              {waiting && (
                <span
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-lg shrink-0"
                  style={{ color: "var(--gold-d)", background: "var(--gold-lt)", border: "1px solid var(--gold-ln)" }}
                >
                  With the placement office
                </span>
              )}
            </div>

            {/* Pipeline strip */}
            <div className="flex items-center gap-1.5 mt-4">
              {STAGES.map((st, idx) => {
                const done = idx < reached;
                return (
                  <div key={st.key} className="flex-1">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        background: done
                          ? "linear-gradient(90deg,var(--jade-d),var(--jade))"
                          : "var(--line-2)",
                      }}
                    />
                    <div
                      className="text-[9.5px] mt-1.5 tracking-wide"
                      style={{ color: done ? "var(--jade-d)" : "var(--ghost)" }}
                    >
                      {st.label}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-5 mt-4 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ash)" }}>
                <Users size={13} style={{ color: "var(--jade)" }} />
                <strong style={{ color: "var(--fg)" }}>{d.candidates_matched}</strong> assessed
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ash)" }}>
                <CheckCircle2 size={13} style={{ color: "var(--jade-d)" }} />
                <strong style={{ color: "var(--fg)" }}>{d.candidates_shortlisted}</strong> shortlisted
              </span>
            </div>

            {/* The agent's own last move, in its words. This is the part the
                company can't see anywhere else. */}
            {d.last_agent_step && (
              <div
                className="flex items-start gap-2.5 mt-4 pt-3.5"
                style={{ borderTop: "1px solid var(--line-2)" }}
              >
                <AgentOrb size={20} still />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--faint)" }}>
                    Last step
                  </div>
                  <div className="text-[12.5px] mt-0.5 leading-relaxed" style={{ color: "var(--fg)" }}>
                    {d.last_agent_step.summary}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
