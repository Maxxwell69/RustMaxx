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
    },
  },
  plugins: [],
};
export default config;
