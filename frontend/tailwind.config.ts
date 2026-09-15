import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Redesign (benchmark PlanFi): verde vivo/energético em vez do
        // institucional anterior -- mesmas CHAVES de antes de propósito, só
        // trocando os valores, pra nenhum componente precisar mudar de
        // classe. "gold"/"goldSoft" ficaram -- redirecionados pro próprio
        // verde -- porque a decisão da sessão foi priorizar verde e não
        // introduzir uma segunda cor de identidade.
        lastro: {
          deep: "#0f5c33",
          mid: "#1c8a4f",
          bright: "#22a35e",
          pale: "#d9f5e2",
          gold: "#1c8a4f",
          goldSoft: "#d9f5e2",
          ink: "#0f2318",
          muted: "#5a6e63",
          paper: "#f2fbf5",
          card: "#ffffff",
          line: "#dcece1",
          cream: "#eafaf0",
          danger: "#c1503a",
          dangerSoft: "#fbe9e5",
          warn: "#c08a2e",
          warnSoft: "#fbf1dd",
          info: "#3d7a8a",
          infoSoft: "#e6f2f4",
        },
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "system-ui", "sans-serif"],
        serif: ["var(--font-jakarta)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
