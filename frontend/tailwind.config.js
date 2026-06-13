/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        raised: "rgb(var(--c-raised) / <alpha-value>)",
        edge: "rgb(var(--c-edge) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)",
        mute: "rgb(var(--c-mute) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: { xl2: "12px" },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / 0.25), 0 8px 24px -12px rgb(0 0 0 / 0.45)",
        glow: "0 0 0 1px rgb(124 92 255 / 0.35), 0 0 24px -4px rgb(124 92 255 / 0.45)",
      },
      keyframes: {
        pulseDot: {
          "0%": { transform: "scale(1)", opacity: "0.9" },
          "70%": { transform: "scale(2.4)", opacity: "0" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: { pulseDot: "pulseDot 1.8s cubic-bezier(0.4,0,0.6,1) infinite" },
    },
  },
  plugins: [],
};
