import type { Config } from "tailwindcss";

/**
 * Tailwind theme is the single source of truth from DESIGN.md.
 * Colors, font sizes, and radii REPLACE the defaults so values
 * outside the design system cannot be referenced.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",

      bg: "#08090A",
      surface: "#131416",
      raised: "#1C1D21",

      border: "#26282D",

      text: {
        DEFAULT: "#F7F8F8",
        muted: "#8A8F98",
        faint: "#5E6066",
      },

      accent: {
        DEFAULT: "#5E6AD2",
        hover: "#6E79D6",
        muted: "#5E6AD226",
      },

      success: { DEFAULT: "#4CB782", muted: "#4CB78226" },
      warning: { DEFAULT: "#DEB949", muted: "#DEB94926" },
      error: { DEFAULT: "#EB5757", muted: "#EB575726" },
    },
    fontFamily: {
      sans: ["Inter", "system-ui", "sans-serif"],
      mono: ["JetBrains Mono", "monospace"],
    },
    fontSize: {
      xs: ["0.6875rem", { lineHeight: "1rem" }],
      sm: ["0.8125rem", { lineHeight: "1.25rem" }],
      base: ["0.9375rem", { lineHeight: "1.5rem" }],
      lg: ["1.375rem", { lineHeight: "1.75rem" }],
    },
    borderRadius: {
      none: "0",
      sm: "4px",
      md: "6px",
      lg: "8px",
      full: "9999px",
    },
    extend: {},
  },
  plugins: [],
} satisfies Config;
