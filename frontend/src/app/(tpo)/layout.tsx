"use client";
import OnyxSidebar from "@/components/ui/OnyxSidebar";

/* Every TPO page renders its own shell (sidebar + top bar), so this layout
   exists to mount the persistent, cross-page piece once, above all of them:
   the Onyx sidebar, a standing launcher not tied to any one run.

   A floating "agent dock" used to sit here too, following every run across
   every page. It duplicated status the drive rows already showed and put a
   permanent bar over the UI to do it, so it was removed — a run's status
   belongs on the drive it concerns. */
export default function TPOLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <OnyxSidebar />
    </>
  );
}
