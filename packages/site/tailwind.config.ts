/**
 * Tailwind v4 loads configuration from CSS (see `src/styles/global.css`,
 * specifically the `@theme { … }` block). This file exists only for:
 *   - editor awareness / file-presence expectations
 *   - a typed mirror of the design tokens, in case a tool wants to read them
 *
 * If you edit token values, edit them in `src/styles/global.css` — this file
 * is advisory, not load-bearing.
 */

export const theme = {
  colors: {
    ink: {
      50: "#fafafa",
      100: "#f5f5f6",
      200: "#e5e5e7",
      300: "#c9c9cd",
      400: "#8a8a90",
      500: "#5a5a60",
      600: "#3d3d43",
      700: "#2a2a2e",
      800: "#1a1a1d",
      850: "#131316",
      900: "#0b0b0d",
      950: "#050506",
    },
    magenta: {
      50: "#fdf4ff",
      100: "#fae8ff",
      200: "#f5d0fe",
      300: "#f0abfc",
      400: "#e879f9",
      500: "#d946ef",
      600: "#c026d3",
      700: "#a21caf",
    },
  },
  fonts: {
    sans: [
      "Inter",
      "ui-sans-serif",
      "system-ui",
      "-apple-system",
      "Segoe UI",
      "Roboto",
      "Helvetica Neue",
      "Arial",
      "sans-serif",
    ],
    mono: [
      "JetBrains Mono",
      "ui-monospace",
      "SFMono-Regular",
      "Menlo",
      "Consolas",
      "Liberation Mono",
      "monospace",
    ],
  },
} as const;

export default { theme };
