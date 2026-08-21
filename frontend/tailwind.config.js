/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f4ff",
          100: "#dce8ff",
          200: "#b9d3ff",
          300: "#85b3ff",
          400: "#4d88ff",
          500: "#1a5cff",
          600: "#0040f5",
          700: "#0030c2",
          800: "#002999",
          900: "#001f73",
        },
        neon: {
          blue: "#4d88ff",
          purple: "#a855f7",
          cyan: "#06b6d4",
          green: "#10b981",
          amber: "#f59e0b",
          rose: "#f43f5e",
        },
        glass: {
          light: "rgba(255,255,255,0.08)",
          medium: "rgba(255,255,255,0.12)",
          heavy: "rgba(255,255,255,0.18)",
          border: "rgba(255,255,255,0.15)",
        },
        dark: {
          950: "#020209",
          900: "#070714",
          800: "#0d0d24",
          700: "#141433",
          600: "#1c1c44",
        },
      },
      backgroundImage: {
        "cosmic": "radial-gradient(ellipse at top, #0d0d2e 0%, #020209 60%)",
        "hero-glow": "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(77,136,255,0.15) 0%, transparent 100%)",
        "card-gradient": "linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)",
        "neon-glow": "linear-gradient(135deg, #4d88ff22 0%, #a855f722 50%, #06b6d422 100%)",
      },
      boxShadow: {
        "glass": "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
        "glow-blue": "0 0 30px rgba(77,136,255,0.3), 0 0 60px rgba(77,136,255,0.15)",
        "glow-purple": "0 0 30px rgba(168,85,247,0.3)",
        "glow-green": "0 0 20px rgba(16,185,129,0.4)",
        "card": "0 4px 24px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05) inset",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4,0,0.6,1) infinite",
        "float": "float 6s ease-in-out infinite",
        "shimmer": "shimmer 2s linear infinite",
        "glow": "glow 2s ease-in-out infinite alternate",
        "slide-up": "slideUp 0.4s ease-out",
        "fade-in": "fadeIn 0.5s ease-out",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-12px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        glow: {
          "from": { boxShadow: "0 0 20px rgba(77,136,255,0.3)" },
          "to": { boxShadow: "0 0 40px rgba(77,136,255,0.6)" },
        },
        slideUp: {
          "from": { transform: "translateY(20px)", opacity: "0" },
          "to": { transform: "translateY(0)", opacity: "1" },
        },
        fadeIn: {
          "from": { opacity: "0" },
          "to": { opacity: "1" },
        },
      },
      backdropBlur: {
        xs: "2px",
        "4xl": "72px",
      },
    },
  },
  plugins: [],
};
