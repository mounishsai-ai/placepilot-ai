"use client";

interface TopBarProps {
  title: string;
  subtitle?: string;
  connected?: boolean;
  /** Right-hand slot — status pills, actions */
  children?: React.ReactNode;
}

export default function TopBar({ title, subtitle, connected, children }: TopBarProps) {
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
        {connected !== undefined && (
          <span
            className="ct-mono inline-flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 rounded-full"
            style={
              connected
                ? { color: "var(--jade-d)", background: "var(--wash)", border: "1px solid #CBEDDD" }
                : { color: "var(--faint)", background: "#F4F6F5", border: "1px solid var(--line)" }
            }
          >
            <i
              className={connected ? "ct-live-dot" : ""}
              style={
                connected
                  ? undefined
                  : { width: 6, height: 6, borderRadius: 999, background: "var(--ghost)", display: "block" }
              }
            />
            {connected ? "Live" : "Offline"}
          </span>
        )}
      </div>
    </header>
  );
}
