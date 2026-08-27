"use client";

interface TopBarProps {
  title: string;
  subtitle?: string;
  /** Right-hand slot — status pills, actions */
  children?: React.ReactNode;
}

export default function TopBar({ title, subtitle, children }: TopBarProps) {
  return (
    <header
      className="h-[62px] flex items-center justify-between px-7 sticky top-0 z-30 bg-white"
      style={{ borderBottom: "1px solid var(--line)" }}
    >
      <div>
        <h1 className="text-[16.5px] leading-none">{title}</h1>
        {subtitle && (
          <p className="text-[11.5px] mt-1" style={{ color: "var(--faint)" }}>
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {children}
      </div>
    </header>
  );
}
