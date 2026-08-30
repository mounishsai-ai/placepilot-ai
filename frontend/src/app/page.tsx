"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Cpu, Mail, Lock, Loader2, ChevronRight, Zap, Users, Brain, CheckCircle, Orbit } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import toast from "react-hot-toast";

const ROLES = [
  { id: "tpo",     label: "TPO",         icon: "🎓", desc: "Placement Officer",  redirect: "/tpo/dashboard"    },
  { id: "student", label: "Student",      icon: "👨‍💻", desc: "Campus Student",     redirect: "/student/dashboard" },
  { id: "company", label: "Company HR",   icon: "🏢", desc: "Hiring Manager",     redirect: "/company/dashboard" },
  { id: "panel",   label: "Panel Member", icon: "🎤", desc: "Interviewer",         redirect: "/panel/schedule"    },
];

const FEATURES = [
  { icon: Brain,        color: "text-blue-400",   bg: "bg-blue-500/15",    label: "Gemini 2.5 Flash",    desc: "Real function-calling agent loops, not scripted steps" },
  { icon: Users,        color: "text-emerald-400", bg: "bg-emerald-500/15", label: "200+ Students",       desc: "Automatically screened and ranked in seconds"  },
  { icon: Zap,          color: "text-purple-400",  bg: "bg-purple-500/15",  label: "Onyx Supervisor",     desc: "Dispatches and reports on agents negotiating your schedule" },
  { icon: CheckCircle,  color: "text-amber-400",   bg: "bg-amber-500/15",   label: "4 Portals",           desc: "TPO · Student · Company · Panel — all in one"  },
];

const STATS = [
  { value: "201", label: "Students" },
  { value: "10",  label: "Drives"   },
  { value: "37",  label: "Matched"  },
  { value: "9",   label: "AI Agents"},
];

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const DEMO: Record<string, [string, string]> = {
    tpo:     ["tpo@college.edu",     "tpo@123"],
    student: ["student@college.edu", "student@123"],
    company: ["hr@tcs.com",          "company@123"],
    panel:   ["panel@company.com",   "panel@123"],
  };

  const handleRoleClick = (roleId: string) => {
    setSelectedRole(roleId);
    const [e, p] = DEMO[roleId];
    setEmail(e);
    setPassword(p);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error("Enter credentials"); return; }
    setLoading(true);
    try {
      const user = await login(email, password);
      const roleConfig = ROLES.find((r) => r.id === user.role);
      toast.success(`Welcome! Redirecting to ${roleConfig?.label} portal…`);
      router.push(roleConfig?.redirect ?? "/");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Login failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="bg-cosmic min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Ambient orbs */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] rounded-full opacity-20 blur-[140px] bg-blue-600 pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full opacity-15 blur-[120px] bg-purple-600 pointer-events-none" />
      <div className="absolute top-1/2 left-0 w-64 h-64 rounded-full opacity-10 blur-[100px] bg-cyan-500 pointer-events-none" />

      <div className="w-full max-w-5xl grid grid-cols-2 gap-12 items-center">
        {/* ── Left: Feature showcase ───────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7 }}
        >
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <motion.div
              initial={{ scale: 0.8, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: "linear-gradient(140deg,var(--jade),#0C8F58)",
                boxShadow: "0 4px 18px rgba(15,169,104,.4)",
              }}
            >
              <Cpu size={22} className="text-white" />
            </motion.div>
            <div>
              <h1 className="text-white font-bold text-xl leading-none">PlacementAI</h1>
              <p className="text-white/40 text-xs mt-0.5">Campus Placement Operations</p>
            </div>
          </div>

          <h2 className="text-white text-3xl font-bold leading-tight mb-3">
            AI-Powered<br />
            <span
              className="text-transparent bg-clip-text"
              style={{ backgroundImage: "linear-gradient(96deg,var(--jade) 0%,var(--jade-mid) 55%,var(--spring) 100%)" }}
            >
              Placement Automation
            </span>
          </h2>
          <p className="text-white/45 text-sm leading-relaxed mb-8 max-w-sm">
            From JD upload to interview scheduling — real Gemini agents that
            pick their own next step, negotiate schedules with each other,
            and always leave the final call to a human.
          </p>

          {/* Feature list */}
          <div className="space-y-3 mb-8">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
                className="flex items-center gap-3"
              >
                <div className={`w-9 h-9 rounded-xl ${f.bg} flex items-center justify-center flex-shrink-0`}>
                  <f.icon size={16} className={f.color} />
                </div>
                <div>
                  <div className="text-white text-sm font-medium">{f.label}</div>
                  <div className="text-white/35 text-xs">{f.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3">
            {STATS.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.07 }}
                className="glass rounded-xl p-3 text-center"
              >
                <div className="text-blue-400 font-bold text-xl">{s.value}</div>
                <div className="text-white/35 text-[10px]">{s.label}</div>
              </motion.div>
            ))}
          </div>

          {/* Tech badges */}
          <div className="flex flex-wrap gap-2 mt-6">
            {["Gemini 2.5 Flash", "Vertex AI", "FastAPI", "Cloud Run", "Next.js 14", "PostgreSQL"].map(t => (
              <span key={t} className="badge badge-gray text-[10px]">{t}</span>
            ))}
          </div>
        </motion.div>

        {/* ── Right: Login form ────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <div className="glass-heavy p-8">
            <h2 className="text-white font-bold text-xl mb-2">Sign in</h2>
            <p className="text-white/40 text-sm mb-6">Select a role to auto-fill demo credentials</p>

            {/* Role selector */}
            <div className="grid grid-cols-2 gap-2 mb-6">
              {ROLES.map((role) => (
                <motion.button
                  key={role.id}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleRoleClick(role.id)}
                  className={`p-3 rounded-xl border text-left transition-all duration-200 ${
                    selectedRole === role.id
                      ? "border-blue-500/60 bg-blue-500/15 shadow-[0_0_12px_rgba(77,136,255,0.2)]"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="text-lg mb-1">{role.icon}</div>
                  <div className="text-white text-xs font-semibold">{role.label}</div>
                  <div className="text-white/35 text-[10px]">{role.desc}</div>
                </motion.button>
              ))}
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="relative">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  className="input-glass pl-10"
                  autoComplete="email"
                />
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="input-glass pl-10"
                  autoComplete="current-password"
                />
              </div>

              <motion.button
                id="login-btn"
                type="submit"
                disabled={loading}
                whileHover={{ scale: loading ? 1 : 1.01 }}
                whileTap={{ scale: loading ? 1 : 0.99 }}
                className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
              >
                {loading
                  ? <><Loader2 size={16} className="animate-spin" /> Authenticating…</>
                  : <><span>Sign In</span><ChevronRight size={16} /></>
                }
              </motion.button>
            </form>

            <p className="text-center text-white/20 text-xs mt-6">
              Hackathon Demo · Credentials auto-fill on role select
            </p>
          </div>
        </motion.div>
      </div>

      {/* Side link, not part of the portal -- a public 3D map of every agent
          and its tools, viewable before anyone signs in. */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.1 }}
        className="absolute bottom-6 right-6"
      >
        <Link
          href="/architecture"
          className="group flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full transition-all duration-200"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          <Orbit size={15} className="text-emerald-400 group-hover:rotate-90 transition-transform duration-500" />
          <span className="text-white/60 group-hover:text-white/90 text-xs font-medium transition-colors">
            See the agent architecture in 3D
          </span>
        </Link>
      </motion.div>
    </main>
  );
}
