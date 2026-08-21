"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Briefcase, Users, Calendar,
  BarChart2, Bell, LogOut, Cpu,
} from "lucide-react";
import { useAuthStore } from "@/lib/store";
import { clsx } from "clsx";

const NAV = [
  { href: "/tpo/dashboard",      icon: LayoutDashboard, label: "Dashboard"      },
  { href: "/tpo/drives",         icon: Briefcase,        label: "Drives"         },
  { href: "/tpo/students",       icon: Users,            label: "Students"       },
  { href: "/tpo/schedule",       icon: Calendar,         label: "Schedule"       },
  { href: "/tpo/analytics",      icon: BarChart2,        label: "Analytics"      },
  { href: "/tpo/notifications",  icon: Bell,             label: "Notifications"  },
];

export default function TPOSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  return (
    <aside className="sidebar flex flex-col py-6">
      {/* Logo */}
      <div className="px-6 mb-8">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Cpu size={16} className="text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-none">PlacementAI</div>
            <div className="text-white/35 text-[10px] mt-0.5">TPO Portal</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href}>
              <motion.div
                whileHover={{ x: 2 }}
                className={clsx("sidebar-item", active && "active")}
              >
                <Icon size={18} className={active ? "text-blue-400" : ""} />
                <span className="text-sm">{label}</span>
                {active && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-400"
                  />
                )}
              </motion.div>
            </Link>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div className="px-2 mt-4 pt-4 border-t border-white/[0.06]">
        <div className="sidebar-item mb-1">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {user?.email?.[0]?.toUpperCase() ?? "T"}
          </div>
          <div className="min-w-0">
            <div className="text-white/70 text-xs truncate">{user?.email}</div>
            <div className="text-white/30 text-[10px]">TPO</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="sidebar-item w-full text-rose-400 hover:text-rose-300 hover:bg-rose-500/[0.08]"
        >
          <LogOut size={16} />
          <span className="text-sm">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
