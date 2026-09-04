import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";

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
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "rgba(14,14,40,0.95)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#f0f4ff",
              backdropFilter: "blur(20px)",
              borderRadius: "12px",
            },
            success: {
              iconTheme: { primary: "#10b981", secondary: "#020209" },
            },
            error: {
              iconTheme: { primary: "#f43f5e", secondary: "#020209" },
            },
          }}
        />
      </body>
    </html>
  );
}
