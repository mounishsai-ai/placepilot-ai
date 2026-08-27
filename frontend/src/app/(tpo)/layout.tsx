"use client";
import AgentDock from "@/components/ui/AgentDock";

/* Every TPO page renders its own shell (sidebar + top bar), so this layout
   exists for one reason: to mount the agent dock once, above all of them.
   The dock removes itself when nothing is running, so there's no permanent
   cost to pages that never see the agent. */
export default function TPOLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AgentDock />
    </>
  );
}
