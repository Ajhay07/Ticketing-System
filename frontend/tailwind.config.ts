import type { Config } from "tailwindcss";

/**
 * Design tokens (Swiss / controlled-brutalist system). Raw values live as CSS
 * variables in app/globals.css (--cf-*); `cf.*` exposes them to Tailwind.
 * Neutrals are Tailwind's slate scale; `brand` is cobalt (#2563EB) and is used
 * sparingly. Radius is capped at 8px and shadows are near-flat by design.
 * Status/priority colours live in components/ui/Badge.tsx.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        cf: {
          black: "var(--cf-black)",
          ink: "var(--cf-ink)",
          slate: "var(--cf-slate)",
          muted: "var(--cf-muted)",
          border: "var(--cf-border)",
          "border-strong": "var(--cf-border-strong)",
          surface: "var(--cf-surface)",
          soft: "var(--cf-surface-soft)",
          blue: "var(--cf-blue)",
          red: "var(--cf-red)",
          orange: "var(--cf-orange)",
          yellow: "var(--cf-yellow)",
          green: "var(--cf-green)",
          purple: "var(--cf-purple)",
        },
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          500: "#2563eb",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      borderRadius: {
        none: "0px",
        sm: "2px",
        DEFAULT: "4px",
        md: "4px",
        lg: "6px",
        xl: "8px",
        "2xl": "8px",
        "3xl": "8px",
      },
      boxShadow: {
        xs: "none",
        sm: "none",
        DEFAULT: "none",
        md: "0 1px 3px rgba(15,23,42,0.06)",
        lg: "0 1px 3px rgba(15,23,42,0.06)",
      },
      transitionDuration: {
        DEFAULT: "150ms",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
        label: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.1em", fontWeight: "700" }],
      },
    },
  },
  plugins: [],
};

export default config;
