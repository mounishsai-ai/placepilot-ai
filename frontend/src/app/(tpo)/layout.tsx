"use client";
import OnyxSidebar from "@/components/ui/OnyxSidebar";

/* Every TPO page renders its own shell (sidebar + top bar), so this layout
   exists to mount the persistent, cross-page piece once, above all of them:
   the Onyx sidebar, a standing launcher not tied to any one run.

   A run's status belongs on the drive it concerns, so it is shown on the drive
   row and its trace page rather than in a bar floating over every screen. */
export default function TPOLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <OnyxSidebar />
    </>
  );
}
