"use client";

interface TopBarProps {
  title: string;
  subtitle?: string;
  connected?: boolean;
}

export default function TopBar({ title, subtitle }: TopBarProps) {
  return (
    <header className="h-16 flex items-center justify-between px-8 border-b border-white/[0.06]"
      style={{ background: "rgba(7,7,20,0.6)", backdropFilter: "blur(16px)" }}>
      <div>
        <h1 className="text-white font-semibold text-lg leading-none">{title}</h1>
        {subtitle && <p className="text-white/40 text-xs mt-0.5">{subtitle}</p>}
      </div>
    </header>
  );
}
