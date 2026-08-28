"use client";
import AgentDock from "@/components/ui/AgentDock";
import OnyxSidebar from "@/components/ui/OnyxSidebar";

/* Every TPO page renders its own shell (sidebar + top bar), so this layout
   exists to mount the two persistent, cross-page pieces once, above all of
   them: the agent dock (removes itself when nothing is running) and the
   Onyx sidebar (a standing launcher, not tied to any one run). */
export default function TPOLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AgentDock />
      <OnyxSidebar />
    </>
  );
}
