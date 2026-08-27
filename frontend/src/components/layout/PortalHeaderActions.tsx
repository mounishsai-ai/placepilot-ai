"use client";
import { LogOut } from "lucide-react";
import { useAuthStore } from "@/lib/store";

/* Sign-out for the portals that have no sidebar.

   TPO and Panel each render a sidebar with the account block and a sign-out
   at the bottom. Student and Company are single-screen portals with only a
   top bar, so they had no way out at all — you had to clear localStorage.

   This drops into TopBar's right-hand slot rather than giving those two
   portals a sidebar they'd otherwise have no navigation to put in. */
export default function PortalHeaderActions({ role }: { role: string }) {
  const { user, logout } = useAuthStore();

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
          style={{ background: "linear-gradient(140deg,var(--jade),#0C8F58)" }}
        >
          {user?.email?.[0]?.toUpperCase() ?? role[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 hidden sm:block">
          <div className="text-[12px] font-medium truncate max-w-[180px]" style={{ color: "var(--fg)" }}>
            {user?.email}
          </div>
          <div className="text-[10px] leading-none" style={{ color: "var(--faint)" }}>{role}</div>
        </div>
      </div>
      <button
        onClick={logout}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all shrink-0"
        style={{ color: "var(--rose)", background: "var(--rose-lt)", border: "1px solid #F3D6D4" }}
      >
        <LogOut size={13} /> Sign out
      </button>
    </div>
  );
}
