"use client";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown } from "lucide-react";
import { clsx } from "clsx";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: number;        // positive = up, negative = down
  accentColor?: string;  // tailwind color name: blue, green, amber, purple
  delay?: number;
}

const ACCENT = {
  blue:   { ring: "ring-blue-500/20",   glow: "shadow-[0_0_30px_rgba(77,136,255,0.15)]",   icon: "bg-blue-500/15 text-blue-400"   },
  green:  { ring: "ring-emerald-500/20", glow: "shadow-[0_0_30px_rgba(16,185,129,0.15)]",  icon: "bg-emerald-500/15 text-emerald-400" },
  amber:  { ring: "ring-amber-500/20",   glow: "shadow-[0_0_30px_rgba(245,158,11,0.15)]",  icon: "bg-amber-500/15 text-amber-400"   },
  purple: { ring: "ring-purple-500/20",  glow: "shadow-[0_0_30px_rgba(168,85,247,0.15)]",  icon: "bg-purple-500/15 text-purple-400" },
  cyan:   { ring: "ring-cyan-500/20",    glow: "shadow-[0_0_30px_rgba(6,182,212,0.15)]",   icon: "bg-cyan-500/15 text-cyan-400"   },
  rose:   { ring: "ring-rose-500/20",    glow: "shadow-[0_0_30px_rgba(244,63,94,0.15)]",   icon: "bg-rose-500/15 text-rose-400"   },
};

export default function MetricCard({
  title, value, subtitle, icon, trend, accentColor = "blue", delay = 0,
}: MetricCardProps) {
  const accent = ACCENT[accentColor as keyof typeof ACCENT] ?? ACCENT.blue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={clsx(
        "metric-card ring-1",
        accent.ring,
        accent.glow
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={clsx("p-3 rounded-xl", accent.icon)}>{icon}</div>
        {trend !== undefined && (
          <span className={clsx(
            "flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full",
            trend >= 0
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-rose-500/15 text-rose-400"
          )}>
            {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="stat-number text-3xl font-bold mb-1">{value}</div>
      <div className="text-white/50 text-sm font-medium">{title}</div>
      {subtitle && <div className="text-white/30 text-xs mt-1">{subtitle}</div>}
    </motion.div>
  );
}
