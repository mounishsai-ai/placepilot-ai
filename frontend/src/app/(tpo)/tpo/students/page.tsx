"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Search, Filter, Users, ChevronDown, TrendingUp,
  BookOpen, Star, AlertTriangle,
} from "lucide-react";
import TPOSidebar from "@/components/layout/TPOSidebar";
import TopBar from "@/components/layout/TopBar";
import { studentsAPI } from "@/lib/api";
import toast from "react-hot-toast";

interface Student {
  id: string;
  roll_no: string;
  name: string;
  branch: string;
  batch: number;
  cgpa: number;
  backlogs_active: number;
  placement_readiness_score: number | null;
  skills: string[];
}

const BRANCHES = ["All", "CSE", "IT", "ECE", "EEE", "ME", "CE", "MCA", "Data Science"];

function ReadinessBar({ score }: { score: number | null }) {
  const s = score ?? 0;
  const color = s >= 80 ? "#10b981" : s >= 60 ? "#4d88ff" : s >= 40 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${s}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-medium" style={{ color }}>{s}</span>
    </div>
  );
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [filtered, setFiltered] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("All");
  const [minCgpa, setMinCgpa] = useState("");
  const [sortBy, setSortBy] = useState<"cgpa" | "readiness" | "name">("cgpa");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  const fetchStudents = useCallback(async () => {
    try {
      const res = await studentsAPI.list();
      setStudents(res.data);
      setFiltered(res.data);
    } catch {
      toast.error("Failed to load students");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  // Filter & sort
  useEffect(() => {
    let result = [...students];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) => s.name.toLowerCase().includes(q) || s.roll_no.toLowerCase().includes(q)
      );
    }
    if (branch !== "All") {
      result = result.filter((s) => s.branch === branch);
    }
    if (minCgpa) {
      result = result.filter((s) => s.cgpa >= parseFloat(minCgpa));
    }
    result.sort((a, b) => {
      if (sortBy === "cgpa") return b.cgpa - a.cgpa;
      if (sortBy === "readiness") return (b.placement_readiness_score ?? 0) - (a.placement_readiness_score ?? 0);
      return a.name.localeCompare(b.name);
    });

    setFiltered(result);
  }, [students, search, branch, minCgpa, sortBy]);

  const stats = {
    total: students.length,
    eligible: students.filter((s) => s.cgpa >= 7.0 && s.backlogs_active === 0).length,
    highReadiness: students.filter((s) => (s.placement_readiness_score ?? 0) >= 80).length,
    withBacklogs: students.filter((s) => s.backlogs_active > 0).length,
  };

  return (
    <div className="min-h-screen bg-cosmic flex">
      <TPOSidebar />
      <div className="ml-64 flex-1 flex flex-col overflow-hidden">
        <TopBar title="Student Management" subtitle={`${students.length} students registered`} />

        <main className="p-8 flex-1 overflow-auto space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            {/* Colour carries meaning here, so it follows the palette's rules:
                ink for a plain count, jade for the two "this is going well"
                measures, rose for the one that is a risk. No gold — gold is
                only ever the agent stopping to ask a person. */}
            {[
              { label: "Total Students",     value: stats.total,          icon: Users,         fg: "var(--fg)",     tint: "rgba(11,23,20,.05)"   },
              { label: "Generally Eligible", value: stats.eligible,       icon: Star,          fg: "var(--jade-d)", tint: "rgba(15,169,104,.10)" },
              { label: "High Readiness ≥80", value: stats.highReadiness,  icon: TrendingUp,    fg: "var(--jade)",   tint: "rgba(18,184,114,.10)" },
              { label: "Active Backlogs",    value: stats.withBacklogs,   icon: AlertTriangle, fg: "var(--rose)",   tint: "rgba(194,69,63,.09)"  },
            ].map((stat) => (
              <div key={stat.label} className="stat-gloss flex items-center gap-3 py-4 px-5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: stat.tint, color: stat.fg }}
                >
                  <stat.icon size={18} />
                </div>
                <div>
                  <div className="font-display text-2xl font-bold leading-none" style={{ color: stat.fg }}>
                    {stat.value}
                  </div>
                  <div className="text-[11.5px] mt-1.5" style={{ color: "var(--ash)" }}>{stat.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="glass-card flex items-center gap-4 flex-wrap">
            {/* Search */}
            <div className="flex items-center gap-2 bg-white/[0.04] rounded-xl px-3 py-2 flex-1 min-w-48">
              <Search size={15} className="text-white/30" />
              <input
                type="text"
                placeholder="Search name or roll no..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-white placeholder-white/25 text-sm outline-none flex-1"
              />
            </div>

            {/* Branch filter */}
            <div className="relative">
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 pr-8 outline-none appearance-none cursor-pointer"
              >
                {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            </div>

            {/* Min CGPA */}
            <input
              type="number"
              placeholder="Min CGPA"
              value={minCgpa}
              onChange={(e) => setMinCgpa(e.target.value)}
              min="0" max="10" step="0.1"
              className="bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 w-28 outline-none"
            />

            {/* Sort */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="bg-white/[0.04] border border-white/10 text-white text-sm rounded-xl px-3 py-2 pr-8 outline-none appearance-none cursor-pointer"
              >
                <option value="cgpa">Sort: CGPA</option>
                <option value="readiness">Sort: Readiness</option>
                <option value="name">Sort: Name</option>
              </select>
              <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            </div>

            <span className="text-white/30 text-sm ml-auto">{filtered.length} results</span>
          </div>

          {/* Table */}
          <div className="glass-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {["Roll No", "Name", "Branch", "Batch", "CGPA", "Backlogs", "Readiness", "Top Skills"].map((h) => (
                      <th key={h} className="text-left text-white/35 font-medium text-xs uppercase tracking-wider px-4 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 10 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 rounded bg-white/[0.03] animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center text-white/30 py-12">
                        No students found
                      </td>
                    </tr>
                  ) : (
                    filtered.map((s, i) => (
                      <motion.tr
                        key={s.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.02, 0.3) }}
                        onClick={() => setSelectedStudent(selectedStudent?.id === s.id ? null : s)}
                        className={`border-b border-white/[0.03] hover:bg-white/[0.03] cursor-pointer transition-colors ${
                          selectedStudent?.id === s.id ? "bg-blue-500/[0.04]" : ""
                        }`}
                      >
                        <td className="px-4 py-3 text-white/50 font-mono text-xs">{s.roll_no}</td>
                        <td className="px-4 py-3 text-white font-medium">{s.name}</td>
                        <td className="px-4 py-3">
                          <span className="badge badge-gray text-[10px]">{s.branch}</span>
                        </td>
                        <td className="px-4 py-3 text-white/50">{s.batch}</td>
                        <td className="px-4 py-3">
                          <span className={`font-bold ${
                            s.cgpa >= 8.5 ? "text-emerald-400" :
                            s.cgpa >= 7.0 ? "text-blue-400" :
                            s.cgpa >= 6.0 ? "text-amber-400" : "text-rose-400"
                          }`}>{s.cgpa.toFixed(2)}</span>
                        </td>
                        <td className="px-4 py-3">
                          {s.backlogs_active > 0 ? (
                            <span className="badge badge-rose text-[10px]">{s.backlogs_active} active</span>
                          ) : (
                            <span className="text-white/25 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <ReadinessBar score={s.placement_readiness_score} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {s.skills.slice(0, 3).map((sk) => (
                              <span key={sk} className="badge badge-blue text-[9px] py-0">{sk}</span>
                            ))}
                            {s.skills.length > 3 && (
                              <span className="text-white/25 text-[9px]">+{s.skills.length - 3}</span>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Student detail panel */}
          {selectedStudent && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card border border-blue-500/20"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-white font-bold text-base">{selectedStudent.name}</h3>
                  <p className="text-white/40 text-sm">{selectedStudent.roll_no} · {selectedStudent.branch} {selectedStudent.batch}</p>
                </div>
                <button onClick={() => setSelectedStudent(null)} className="text-white/30 hover:text-white transition-colors text-lg">✕</button>
              </div>
              <div className="grid grid-cols-4 gap-4 mb-4">
                {[
                  { label: "CGPA",          value: selectedStudent.cgpa.toFixed(2) },
                  { label: "Active Backlogs", value: selectedStudent.backlogs_active },
                  { label: "Readiness Score", value: `${selectedStudent.placement_readiness_score ?? "N/A"}/100` },
                  { label: "Total Skills",   value: selectedStudent.skills.length },
                ].map((stat) => (
                  <div key={stat.label} className="bg-white/[0.03] rounded-xl p-3 text-center">
                    <div className="text-white font-bold text-lg">{stat.value}</div>
                    <div className="text-white/40 text-xs">{stat.label}</div>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-2">
                  <BookOpen size={12} /> All Skills
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedStudent.skills.map((sk) => (
                    <span key={sk} className="badge badge-blue text-xs">{sk}</span>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </main>
      </div>
    </div>
  );
}
