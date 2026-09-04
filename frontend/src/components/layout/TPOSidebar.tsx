"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Briefcase, Users, Calendar,
  BarChart2, Bell, LogOut,
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
    <aside className="sidebar flex flex-col py-5">
      {/* The product's mark — deliberately plain. The animated orb is the
          agent's identity and is never used as a brand logo. */}
      <div className="px-5 mb-7">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-[9px] flex items-center justify-center text-white font-display font-extrabold text-[15px]"
            style={{
              background: "linear-gradient(140deg,var(--jade),#0C8F58)",
              boxShadow: "0 2px 8px rgba(15,169,104,.3)",
            }}
          >
            P
          </div>
          <div>
            <div className="font-display font-bold text-[14.5px] leading-tight" style={{ color: "var(--fg)" }}>
              PlacePilot AI
            </div>
            <div className="ct-mono text-[8px] tracking-[0.13em] mt-0.5" style={{ color: "var(--faint)" }}>
              TPO PORTAL
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 flex flex-col gap-0.5">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={href} href={href}>
              <div className={clsx("sidebar-item", active && "active")}>
                <Icon size={17} />
                <span className="text-[13px]">{label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="px-2 mt-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="sidebar-item mb-0.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
            style={{ background: "linear-gradient(140deg,var(--jade),#0C8F58)" }}
          >
            {user?.email?.[0]?.toUpperCase() ?? "T"}
          </div>
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold truncate" style={{ color: "var(--fg)" }}>
              {user?.email}
            </div>
            <div className="text-[9.5px]" style={{ color: "var(--faint)" }}>TPO</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="sidebar-item w-full"
          style={{ color: "var(--rose)" }}
        >
          <LogOut size={16} />
          <span className="text-[13px]">Sign out</span>
        </button>
      </div>
    </aside>
  );
}
