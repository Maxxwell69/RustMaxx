import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        rust: {
          /** Warm charcoal so UI reads with orange fire accents */
          panel: "#090807",
          surface: "#12100e",
          border: "#2a221c",
          mute: "#a8a29e",
          green: "#22c55e",
          /** Primary accent — fiery orange (class name `rust-cyan` kept for compatibility) */
          cyan: "#fb923c",
          /** Gold highlight for hovers / secondary emphasis */
          amber: "#fbbf24",
          danger: "#ef4444",
        },
      },
      boxShadow: {
        "rust-glow":
          "0 0 22px rgba(251, 146, 60, 0.55), 0 0 48px rgba(234, 88, 12, 0.2), 0 0 2px rgba(254, 243, 199, 0.35)",
        "rust-glow-lg":
          "0 0 28px rgba(251, 146, 60, 0.65), 0 0 64px rgba(234, 88, 12, 0.28), 0 0 3px rgba(254, 243, 199, 0.45)",
        "rust-glow-subtle": "0 0 14px rgba(251, 146, 60, 0.42), 0 0 28px rgba(234, 88, 12, 0.12)",
      },
    },
  },
  plugins: [],
};
export default config;
