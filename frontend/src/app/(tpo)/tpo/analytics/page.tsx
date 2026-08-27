"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, ResponsiveContainer,
  LineChart, Line,
} from "recharts";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import { analyticsAPI } from "@/lib/api";
import toast from "react-hot-toast";

/* Recharts takes colour as SVG attributes, not CSS classes — which is why
   this page survived the light-theme migration looking broken while every
   other one was carried by the shim. Axis labels were white-on-white.

   Axis ink is set once here so the four charts can't drift apart. */
const AXIS      = "#5F706A";              // --ash: tick labels
const AXIS_HEAD = "#0B1714";              // --fg: category names, which are read
const GRID      = "rgba(11,23,20,.07)";

/* Branch categories. Jade family walked from deep to pale rather than six
   unrelated hues — these are one measure split by branch, not six things. */
const BRANCH_SERIES = ["#0A6B44", "#0FA968", "#12B872", "#34D89A", "#7FE0B6", "#A9F1D2"];

/* Readiness is a ranked scale, so the colour is a ramp: bad, neutral, good,
   best. Deliberately no amber in it — gold means the agent has stopped and
   needs a person, and a readiness bucket never does. */
const PIE_COLORS: Record<string, string> = {
  not_ready:    "#C2453F",
  developing:   "#93A29C",
  ready:        "#12B872",
  highly_ready: "#0A6B44",
};

const PIE_LABELS: Record<string, string> = {
  not_ready:    "Not Ready",
  developing:   "Developing",
  ready:        "Ready",
  highly_ready: "Highly Ready",
};

const TooltipStyle = {
  contentStyle: {
    background: "#FFFFFF",
    border: "1px solid #E4EAE7",
    borderRadius: "12px",
    color: "#0B1714",
    fontSize: "12px",
    boxShadow: "0 8px 26px rgba(11,23,20,.12)",
  },
  cursor: { fill: "rgba(15,169,104,.07)" },
};

type AnalystResult = {
  answer: string;
  sql: string;
  row_count: number;
  sample_rows: Record<string, unknown>[];
};

export default function AnalyticsPage() {
  const [skillGap, setSkillGap] = useState<Record<string, unknown>[]>([]);
  const [readiness, setReadiness] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [analystQuestion, setAnalystQuestion] = useState("");
  const [analystResult, setAnalystResult] = useState<AnalystResult | null>(null);
  const [analystLoading, setAnalystLoading] = useState(false);
  const [analystError, setAnalystError] = useState("");

  useEffect(() => {
    Promise.all([analyticsAPI.skillGap(), analyticsAPI.readiness()])
      .then(([sgRes, rRes]) => {
        setSkillGap(sgRes.data.skill_gaps?.slice(0, 15) ?? []);
        setReadiness(rRes.data);
      })
      .catch(() => toast.error("Failed to load analytics"))
      .finally(() => setLoading(false));
  }, []);

  const pieData = readiness
    ? Object.entries((readiness as Record<string, unknown>).distribution as Record<string, number> ?? {}).map(
        ([key, val]) => ({ name: PIE_LABELS[key], value: val, color: PIE_COLORS[key] })
      )
    : [];

  // Mock placement trend data for demo
  const trendData = [
    { month: "Jan", placed: 12 }, { month: "Feb", placed: 28 },
    { month: "Mar", placed: 45 }, { month: "Apr", placed: 38 },
    { month: "May", placed: 62 }, { month: "Jun", placed: 74 },
  ];

  const branchData = (((readiness as Record<string, unknown>)?.by_branch as Record<string, unknown>[]) ?? [])
    .slice(0, 8)
    .map((b) => ({
      branch: b.branch,
      readiness: b.avg_readiness,
      count: b.student_count,
    }));

  const askAnalyst = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = analystQuestion.trim();
    if (!question) return;

    setAnalystLoading(true);
    setAnalystError("");
    try {
      const response = await analyticsAPI.ask(question);
      setAnalystResult(response.data);
    } catch {
      setAnalystResult(null);
      setAnalystError("The analyst is unavailable right now. Please try again.");
    } finally {
      setAnalystLoading(false);
    }
  };

  const sampleColumns = analystResult?.sample_rows[0]
    ? Object.keys(analystResult.sample_rows[0])
    : [];

  return (
    <div className="flex min-h-screen bg-cosmic">
      <TPOSidebar />

      <div className="ml-64 flex-1 flex flex-col">
        <TopBar title="Placement Analytics" subtitle="Skill gaps, readiness, and placement trends" />

        <main className="flex-1 p-8 space-y-8">
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl border border-emerald-300/15 bg-gradient-to-br from-emerald-500/[0.13] via-[#10251e] to-[#111927] p-6 shadow-[0_18px_60px_rgba(3,30,20,.24)]"
          >
            <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-300/10 blur-3xl" />
            <div className="relative flex flex-col gap-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,.95)]" />
                    Live placement intelligence
                  </div>
                  <h2 className="text-xl font-semibold text-white">Ask the Analyst</h2>
                  <p className="mt-1 text-sm text-white/55">Ask a question in plain English. The agent queries live placement data and shows its evidence.</p>
                </div>
                <div className="hidden rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-white/55 sm:block">
                  TPO-only access
                </div>
              </div>

              <form onSubmit={askAnalyst} className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={analystQuestion}
                  onChange={(event) => setAnalystQuestion(event.target.value)}
                  placeholder="e.g. Which drive has the most shortlisted candidates?"
                  maxLength={500}
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#07120e]/70 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 transition focus:border-emerald-300/60 focus:ring-2 focus:ring-emerald-300/15"
                />
                <button
                  type="submit"
                  disabled={analystLoading || !analystQuestion.trim()}
                  className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {analystLoading ? "Analysing…" : "Ask Analyst"}
                </button>
              </form>

              <div className="flex flex-wrap gap-2 text-xs text-white/45">
                <span className="py-1">Try:</span>
                {[
                  "How many CSE students have a CGPA above 8?",
                  "Which drive has the most shortlisted candidates?",
                ].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setAnalystQuestion(example)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-left transition hover:border-emerald-300/30 hover:bg-emerald-300/10 hover:text-emerald-100"
                  >
                    {example}
                  </button>
                ))}
              </div>

              {analystError && (
                <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{analystError}</p>
              )}

              {analystResult && (
                <div className="rounded-xl border border-white/10 bg-[#07120e]/55 p-4">
                  <p className="text-sm leading-6 text-white/85">{analystResult.answer}</p>
                  <p className="mt-2 text-xs text-white/40">{analystResult.row_count} row{analystResult.row_count === 1 ? "" : "s"} read</p>

                  {analystResult.sql && (
                    <details className="mt-4 rounded-lg border border-white/[0.08] bg-black/15 px-3 py-2 text-xs">
                      <summary className="cursor-pointer font-medium text-emerald-200">Show the query used</summary>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-emerald-100/75">{analystResult.sql}</pre>
                    </details>
                  )}

                  {sampleColumns.length > 0 && (
                    <div className="mt-4 overflow-x-auto rounded-lg border border-white/[0.08]">
                      <table className="w-full min-w-max text-left text-xs">
                        <thead className="bg-white/[0.05] text-white/45">
                          <tr>
                            {sampleColumns.map((column) => <th key={column} className="px-3 py-2 font-medium">{column}</th>)}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.06] text-white/75">
                          {analystResult.sample_rows.map((row, index) => (
                            <tr key={index}>
                              {sampleColumns.map((column) => (
                                <td key={column} className="max-w-[260px] px-3 py-2 align-top">
                                  {typeof row[column] === "object" && row[column] !== null
                                    ? JSON.stringify(row[column])
                                    : String(row[column] ?? "—")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.section>

          {/* ── Row 1: Skill Gap + Readiness Donut ──────────────────── */}
          <div className="grid grid-cols-3 gap-6">
            {/* Skill Gap — 2/3 width */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="col-span-2 glass-card"
            >
              <h2 className="text-white font-semibold mb-1">Skill Gap Analysis</h2>
              <p className="text-white/40 text-xs mb-6">Demand (# drives requiring skill) vs student supply</p>
              {loading ? (
                <div className="h-72 rounded-xl bg-white/[0.03] animate-pulse" />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={skillGap}
                    layout="vertical"
                    margin={{ top: 0, right: 20, bottom: 0, left: 80 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                    <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis
                      dataKey="skill"
                      type="category"
                      tick={{ fill: AXIS_HEAD, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={80}
                    />
                    <Tooltip {...TooltipStyle} />
                    <Bar dataKey="demand_score"    fill="#0A6B44" radius={4} name="Drive Demand" />
                    <Bar dataKey="students_with_skill" fill="#34D89A" radius={4} name="Students with Skill" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </motion.div>

            {/* Readiness Donut — 1/3 width */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="glass-card"
            >
              <h2 className="text-white font-semibold mb-1">Readiness Distribution</h2>
              <p className="text-white/40 text-xs mb-4">Student placement readiness tiers</p>
              {loading ? (
                <div className="h-56 rounded-xl bg-white/[0.03] animate-pulse" />
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={TooltipStyle.contentStyle}
                        formatter={(v) => [v, ""]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 mt-2">
                    {pieData.map((d) => (
                      <div key={d.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                          <span className="text-white/50 text-xs">{d.name}</span>
                        </div>
                        <span className="text-white text-xs font-semibold">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </motion.div>
          </div>

          {/* ── Row 2: Placement Trend + Branch Stats ─────────────── */}
          <div className="grid grid-cols-2 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-card"
            >
              <h2 className="text-white font-semibold mb-1">Placement Trend</h2>
              <p className="text-white/40 text-xs mb-6">Students placed per month (2025)</p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="month" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...TooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="placed"
                    stroke="#0FA968"
                    strokeWidth={2.5}
                    dot={{ fill: "#0FA968", strokeWidth: 0, r: 4 }}
                    activeDot={{ r: 6, fill: "#0A6B44" }}
                    name="Students Placed"
                  />
                </LineChart>
              </ResponsiveContainer>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-card"
            >
              <h2 className="text-white font-semibold mb-1">Branch-wise Readiness</h2>
              <p className="text-white/40 text-xs mb-6">Average readiness score by branch</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={branchData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="branch" tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                  <Tooltip {...TooltipStyle} />
                  <Bar dataKey="readiness" radius={[6, 6, 0, 0]} name="Avg Readiness">
                    {branchData.map((_, idx) => (
                      <Cell key={idx} fill={BRANCH_SERIES[idx % BRANCH_SERIES.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </motion.div>
          </div>
        </main>
      </div>
    </div>
  );
}
