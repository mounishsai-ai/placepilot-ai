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
  /** the one card carrying the agent's own headline number gets the bright fill */
  hero?: boolean;
  /** accepted for call-site compatibility; the card is jade regardless */
  accentColor?: string;
  delay?: number;
}

/* Every accent resolves to jade on the dark card — the palette says the card
   is the agent's territory, so nothing here is blue or purple any more. Gold
   stays reserved for the one state that means a human is needed. */
const ICON_TINT = "rgba(52,216,154,.16)";
const ICON_FG = "#7FE9C0";

export default function MetricCard({
  title, value, subtitle, icon, trend, hero = false, delay = 0,
}: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={clsx("metric-card", hero && "stat-hero")}
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className="p-3 rounded-xl"
          style={{
            background: hero ? "rgba(255,255,255,.18)" : ICON_TINT,
            color: hero ? "#fff" : ICON_FG,
          }}
        >
          {icon}
        </div>
        {trend !== undefined && (
          <span
            className="ct-mono flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full"
            style={{
              background: hero ? "rgba(255,255,255,.2)" : ICON_TINT,
              color: hero ? "#fff" : ICON_FG,
            }}
          >
            {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="stat-number text-[29px] font-bold mb-1 text-white">{value}</div>
      <div className="text-sm font-medium" style={{ color: "rgba(234,246,241,.62)" }}>{title}</div>
      {subtitle && (
        <div className="text-xs mt-1" style={{ color: "rgba(234,246,241,.4)" }}>{subtitle}</div>
      )}
    </motion.div>
  );
}
