import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        lastro: {
          deep: "#12241c",
          mid: "#2f5d43",
          bright: "#3c7856",
          pale: "#eaf1ec",
          gold: "#b08a3e",
          goldSoft: "#f6efe0",
          ink: "#1b241d",
          muted: "#5b6a60",
          paper: "#f8f6f1",
          card: "#ffffff",
          line: "#e1ded4",
          cream: "#f3efe6",
          danger: "#a6432f",
          dangerSoft: "#f7e9e5",
          warn: "#b5822c",
          warnSoft: "#f7edd9",
          info: "#3d6a86",
          infoSoft: "#e8eff3",
        },
      },
      fontFamily: {
        sans: ["var(--font-ibm-plex)", "system-ui", "sans-serif"],
        serif: ["var(--font-libre-caslon)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
