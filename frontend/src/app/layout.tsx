import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import LiquidGlassFilter from "@/components/ui/LiquidGlassFilter";

export const metadata: Metadata = {
  title: "PlacePilot AI — AI-Powered Campus Placement Agent",
  description: "Intelligent campus placement coordination powered by AI agents. JD analysis, candidate matching, interview scheduling, and real-time analytics.",
  keywords: ["campus placement", "AI", "interview scheduling", "placement agent"],
  authors: [{ name: "Placement Cell AI Team" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-cosmic min-h-screen antialiased">
        <LiquidGlassFilter />
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            // Left over from the dark theme: near-black toasts with pale text,
            // on an app that has been light for a while.
            style: {
              background: "rgba(255,255,255,0.86)",
              border: "1px solid rgba(255,255,255,0.7)",
              color: "#0B1714",
              backdropFilter: "blur(20px) saturate(180%)",
              borderRadius: "12px",
              boxShadow: "0 12px 32px -14px rgba(11,23,20,.22)",
            },
            success: {
              iconTheme: { primary: "#0FA968", secondary: "#FFFFFF" },
            },
            error: {
              iconTheme: { primary: "#C2453F", secondary: "#FFFFFF" },
            },
          }}
        />
      </body>
    </html>
  );
}
