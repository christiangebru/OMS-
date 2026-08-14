/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"]
      },
      colors: {
        canvas: "#F4F0E8",
        surface: "#FFFdf8",
        ink: {
          DEFAULT: "#1C1916",
          muted: "#6B645C",
          faint: "#9A9389"
        },
        line: {
          DEFAULT: "#E4DDD2",
          strong: "#D4CBBC"
        },
        brand: {
          50: "#E8EEEA",
          100: "#D3DFD7",
          500: "#3E5C48",
          600: "#3E5C48",
          700: "#2F4738"
        },
        accent: {
          DEFAULT: "#3E5C48",
          hover: "#334C3C",
          soft: "#E7EEE9"
        },
        urgent: "#B45309",
        warn: "#C2410C"
      },
      boxShadow: {
        card: "0 1px 2px rgb(28 25 22 / 0.04), 0 8px 24px -12px rgb(28 25 22 / 0.08)",
        lift: "0 1px 1px rgb(28 25 22 / 0.04), 0 12px 32px -16px rgb(28 25 22 / 0.12)"
      },
      borderRadius: {
        control: "8px"
      }
    }
  },
  plugins: []
};
