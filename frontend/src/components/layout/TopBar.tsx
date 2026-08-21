"use client";
import { Bell, Wifi, WifiOff } from "lucide-react";
import { useNotificationsStore } from "@/lib/store";

interface TopBarProps {
  title: string;
  subtitle?: string;
  connected?: boolean;
}

export default function TopBar({ title, subtitle, connected = true }: TopBarProps) {
  const { unreadCount } = useNotificationsStore();

  return (
    <header className="h-16 flex items-center justify-between px-8 border-b border-white/[0.06]"
      style={{ background: "rgba(7,7,20,0.6)", backdropFilter: "blur(16px)" }}>
      <div>
        <h1 className="text-white font-semibold text-lg leading-none">{title}</h1>
        {subtitle && <p className="text-white/40 text-xs mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4">
        {/* WS status */}
        <div className={`flex items-center gap-1.5 text-xs font-medium ${connected ? "text-emerald-400" : "text-amber-400"}`}>
          {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
          {connected ? "Live" : "Offline"}
        </div>
        {/* Notifications bell */}
        <button className="relative p-2 rounded-xl glass hover:bg-white/10 transition-colors">
          <Bell size={18} className="text-white/60" />
          {unreadCount > 0 && (
            <span className="notif-dot" />
          )}
        </button>
      </div>
    </header>
  );
}
