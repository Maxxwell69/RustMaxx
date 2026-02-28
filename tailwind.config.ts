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
          panel: "#0c0d0e",
          surface: "#111215",
          border: "#1e2124",
          mute: "#6b7280",
          green: "#22c55e",
          cyan: "#06b6d4",
          amber: "#f59e0b",
          danger: "#ef4444",
        },
      },
      boxShadow: {
        "rust-glow": "0 0 20px rgba(6, 182, 212, 0.5), 0 0 40px rgba(6, 182, 212, 0.2)",
        "rust-glow-lg": "0 0 25px rgba(6, 182, 212, 0.6), 0 0 50px rgba(6, 182, 212, 0.25)",
        "rust-glow-subtle": "0 0 12px rgba(6, 182, 212, 0.35)",
      },
    },
  },
  plugins: [],
};
export default config;
