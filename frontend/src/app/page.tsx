"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Mail, Lock, Loader2, ChevronRight } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import toast from "react-hot-toast";

const ROLES = [
  { id: "tpo",     label: "TPO",           icon: "🎓", desc: "Placement Cell Officer", redirect: "/tpo/dashboard"     },
  { id: "student", label: "Student",        icon: "👨‍💻", desc: "Campus Student",         redirect: "/student/dashboard"  },
  { id: "company", label: "Company HR",     icon: "🏢", desc: "Hiring Manager",          redirect: "/company/dashboard"  },
  { id: "panel",   label: "Panel Member",   icon: "🎤", desc: "Interview Panelist",       redirect: "/panel/schedule"     },
];

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  // Quick-fill demo creds
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
      toast.success(`Welcome back! Redirecting to ${roleConfig?.label} portal…`);
      router.push(roleConfig?.redirect ?? "/");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Login failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="bg-cosmic min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient orbs */}
      <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full opacity-20 blur-[120px] bg-blue-600 pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-80 h-80 rounded-full opacity-15 blur-[100px] bg-purple-600 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, type: "spring" }}
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 mb-4 shadow-[0_0_40px_rgba(77,136,255,0.4)]"
          >
            <Cpu size={28} className="text-white" />
          </motion.div>
          <h1 className="text-3xl font-bold text-white">PlacementAI</h1>
          <p className="text-white/40 text-sm mt-1">AI-Powered Campus Placement Platform</p>
        </div>

        {/* Card */}
        <div className="glass-heavy p-8">
          <h2 className="text-white font-semibold text-lg mb-6">Sign in to your portal</h2>

          {/* Role selector */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            {ROLES.map((role) => (
              <motion.button
                key={role.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleRoleClick(role.id)}
                className={`p-3 rounded-xl border text-left transition-all duration-200 ${
                  selectedRole === role.id
                    ? "border-blue-500/60 bg-blue-500/15"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20"
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

          <p className="text-center text-white/25 text-xs mt-6">
            Click a role above to auto-fill demo credentials
          </p>
        </div>

        <p className="text-center text-white/20 text-xs mt-6">
          AI Campus Placement Agent · Hackathon Demo
        </p>
      </motion.div>
    </main>
  );
}
