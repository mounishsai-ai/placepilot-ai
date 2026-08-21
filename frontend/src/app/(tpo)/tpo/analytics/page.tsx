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

const NEON = ["#4d88ff", "#a855f7", "#06b6d4", "#10b981", "#f59e0b", "#f43f5e"];

const PIE_COLORS: Record<string, string> = {
  not_ready:    "#f43f5e",
  developing:   "#f59e0b",
  ready:        "#4d88ff",
  highly_ready: "#10b981",
};

const PIE_LABELS: Record<string, string> = {
  not_ready:    "Not Ready",
  developing:   "Developing",
  ready:        "Ready",
  highly_ready: "Highly Ready",
};

const TooltipStyle = {
  contentStyle: {
    background: "rgba(14,14,40,0.95)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "12px",
    color: "#f0f4ff",
    fontSize: "12px",
  },
  cursor: { fill: "rgba(255,255,255,0.04)" },
};

export default function AnalyticsPage() {
  const [skillGap, setSkillGap] = useState<Record<string, unknown>[]>([]);
  const [readiness, setReadiness] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="flex min-h-screen bg-cosmic">
      <TPOSidebar />

      <div className="ml-64 flex-1 flex flex-col">
        <TopBar title="Placement Analytics" subtitle="Skill gaps, readiness, and placement trends" />

        <main className="flex-1 p-8 space-y-8">
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
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis
                      dataKey="skill"
                      type="category"
                      tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={80}
                    />
                    <Tooltip {...TooltipStyle} />
                    <Bar dataKey="demand_score"    fill="#4d88ff" radius={4} name="Drive Demand" />
                    <Bar dataKey="students_with_skill" fill="#10b981" radius={4} name="Students with Skill" />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip {...TooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="placed"
                    stroke="#4d88ff"
                    strokeWidth={2.5}
                    dot={{ fill: "#4d88ff", strokeWidth: 0, r: 4 }}
                    activeDot={{ r: 6, fill: "#4d88ff", boxShadow: "0 0 12px #4d88ff" }}
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="branch" tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                  <Tooltip {...TooltipStyle} />
                  <Bar dataKey="readiness" radius={[6, 6, 0, 0]} name="Avg Readiness">
                    {branchData.map((_, idx) => (
                      <Cell key={idx} fill={NEON[idx % NEON.length]} />
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
