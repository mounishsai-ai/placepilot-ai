"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Cpu, Mail, Lock, Loader2, ChevronRight, Orbit } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import toast from "react-hot-toast";

/* A sign-in screen, not a landing page. This is an internal tool: whoever
   opens it already knows what it is and wants to get into their portal. The
   left column says what the system does in two sentences and stops -- no
   feature grid, no counters. An earlier version showed a stat row ("201
   students", "37 matched") read from a hardcoded array, which is exactly the
   kind of number that quietly undermines every real one elsewhere. */

const ROLES = [
  { id: "tpo",     label: "TPO",          desc: "Placement officer", redirect: "/tpo/dashboard"     },
  { id: "student", label: "Student",      desc: "Campus student",    redirect: "/student/dashboard" },
  { id: "company", label: "Company HR",   desc: "Hiring manager",    redirect: "/company/dashboard" },
  { id: "panel",   label: "Panel member", desc: "Interviewer",       redirect: "/panel/schedule"    },
];

const DEMO: Record<string, [string, string]> = {
  tpo:     ["tpo@college.edu",     "tpo@123"],
  student: ["student@college.edu", "student@123"],
  company: ["hr@tcs.com",          "company@123"],
  panel:   ["panel@company.com",   "panel@123"],
};

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const handleRoleClick = (roleId: string) => {
    setSelectedRole(roleId);
    const [e, p] = DEMO[roleId];
    setEmail(e);
    setPassword(p);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error("Enter your email and password"); return; }
    setLoading(true);
    try {
      const user = await login(email, password);
      const roleConfig = ROLES.find((r) => r.id === user.role);
      router.push(roleConfig?.redirect ?? "/");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Sign in failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--paper)" }}>
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-14 items-center">
        {/* ── Left: what this is ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center gap-2.5 mb-9">
            <div
              className="w-9 h-9 rounded-[10px] flex items-center justify-center"
              style={{ background: "linear-gradient(140deg,var(--jade),#0C8F58)" }}
            >
              <Cpu size={18} className="text-white" />
            </div>
            <div>
              <h1 className="font-display font-bold text-[15px] leading-none" style={{ color: "var(--fg)" }}>
                PlacePilot AI
              </h1>
              <p className="text-[10.5px] mt-1" style={{ color: "var(--faint)" }}>
                Campus placement operations
              </p>
            </div>
          </div>

          <h2
            className="text-[26px] leading-[1.2] tracking-[-0.02em] mb-4 max-w-[19ch]"
            style={{ color: "var(--fg)" }}
          >
            Placement drives, run by agents that <em>show their work.</em>
          </h2>

          <p className="text-[13.5px] leading-relaxed max-w-[46ch]" style={{ color: "var(--ash)" }}>
            Upload a job description and the system reads it, works out who
            qualifies, ranks them against the role, and plans an interview
            schedule that does not clash with any other drive. It stops and asks
            a person before anything is final — and every step it took is on
            screen, in order.
          </p>

          <Link
            href="/architecture"
            className="inline-flex items-center gap-2 mt-7 text-[12.5px] transition-opacity hover:opacity-70"
            style={{ color: "var(--jade-d)" }}
          >
            <Orbit size={14} />
            See how the agents fit together
          </Link>
        </motion.div>

        {/* ── Right: sign in ───────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08 }}
        >
          <div
            className="rounded-2xl p-7"
            style={{ background: "var(--card)", border: "1px solid var(--line)", boxShadow: "0 4px 22px rgba(11,23,20,.06)" }}
          >
            <h2 className="text-[17px] mb-1" style={{ color: "var(--fg)" }}>Sign in</h2>
            <p className="text-[12.5px] mb-6" style={{ color: "var(--ash)" }}>
              This is a demonstration. Pick a role to fill in its shared
              credentials — these are published on purpose, and the data behind
              them is seeded, not real student records.
            </p>

            <div className="grid grid-cols-2 gap-2 mb-6">
              {ROLES.map((role) => {
                const on = selectedRole === role.id;
                return (
                  <button
                    key={role.id}
                    onClick={() => handleRoleClick(role.id)}
                    className="px-3 py-2.5 rounded-xl text-left transition-all duration-150"
                    style={{
                      border: `1px solid ${on ? "var(--jade-mid)" : "var(--line)"}`,
                      background: on ? "var(--wash)" : "transparent",
                    }}
                  >
                    <div
                      className="text-[12.5px] font-semibold"
                      style={{ color: on ? "var(--jade-d)" : "var(--fg)" }}
                    >
                      {role.label}
                    </div>
                    <div className="text-[10.5px] mt-0.5" style={{ color: "var(--faint)" }}>
                      {role.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleLogin} className="space-y-3">
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--faint)" }} />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email address"
                  autoComplete="email"
                  className="w-full text-[13.5px] rounded-xl pl-10 pr-4 py-3 outline-none transition-colors"
                  style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
                />
              </div>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--faint)" }} />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  className="w-full text-[13.5px] rounded-xl pl-10 pr-4 py-3 outline-none transition-colors"
                  style={{ background: "var(--wash-2)", border: "1px solid var(--line)", color: "var(--fg)" }}
                />
              </div>

              <button
                id="login-btn"
                type="submit"
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2 !py-3 text-[13.5px] disabled:opacity-60"
              >
                {loading
                  ? <><Loader2 size={15} className="animate-spin" /> Signing in…</>
                  : <>Sign in <ChevronRight size={15} /></>
                }
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
