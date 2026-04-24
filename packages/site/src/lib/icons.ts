// Lazy helper to load a simple-icons SVG path at build time.
// We inline <path d="…"/> and render it ourselves — this avoids the <title>
// element + role="img" from the upstream SVG and lets us control sizing/color
// cleanly from parent styles.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = resolve(__dirname, "..", "..", "node_modules", "simple-icons", "icons");

const pathCache = new Map<string, string>();

/** Returns the value of the `d` attribute of the first <path> in a simple-icons SVG. */
export function getIconPath(slug: string): string | null {
  const cached = pathCache.get(slug);
  if (cached !== undefined) return cached;

  // Custom marks win over simple-icons to let us override when the upstream
  // icon is wrong for our purposes (e.g. postgresql's elephant for Neon).
  if (CUSTOM_ICON_PATHS[slug]) {
    pathCache.set(slug, CUSTOM_ICON_PATHS[slug]);
    return CUSTOM_ICON_PATHS[slug];
  }

  const file = resolve(ICONS_DIR, `${slug}.svg`);
  if (!existsSync(file)) return null;

  const raw = readFileSync(file, "utf8");
  const match = raw.match(/<path[^>]*\sd="([^"]+)"/);
  if (!match) return null;
  const iconPath = match[1] ?? null;
  if (iconPath) pathCache.set(slug, iconPath);
  return iconPath;
}

// Custom marks for providers that either aren't in simple-icons or whose
// simple-icons entry doesn't match the right brand. All hand-authored as
// simplified geometric shapes — recognizable but clearly not claiming to be
// the official wordmark. 24x24 viewBox throughout.
export const CUSTOM_ICON_PATHS: Record<string, string> = {
  // ─── Neon — stylized lightning-bolt "N", the core of their brand mark ───
  // simple-icons maps `neon` to postgresql's elephant, which is wrong.
  // This is a chunky lowercase "n" with the stem kinked like Neon's glowing mark.
  neon: "M4 4 L4 20 L8 20 L8 10.5 L14.5 20 L20 20 L20 4 L16 4 L16 13.2 L9.8 4 Z",

  // ─── Convex — three stacked wedges ("v") representing compute layers ───
  // Convex's real mark is three overlapping triangles forming a "V".
  convex: "M12 3 L22 20 L16 20 L12 13.5 L8 20 L2 20 Z M12 8 L15.5 14 L8.5 14 Z",

  // ─── DeepSeek — stylized whale silhouette ───
  // DeepSeek's mark is a blue whale. Reduced to a clean side-profile.
  deepseek:
    "M3 13 C 6 10, 9 10, 12 12 C 14 13.5, 17 13.5, 20 12 C 21 11.5, 22 12, 22 13 C 22 16, 19 18, 15 18 C 11 18, 8 17, 5 15 L 3 15 Z M18 9 a1.3 1.3 0 1 1 0.01 0 Z",

  // ─── Modal — diagonally split square (compute / sandbox) ───
  modal: "M4 4 L20 4 L20 20 L4 20 Z M4 4 L20 20 M8 8 L8 10 M16 14 L16 16",

  // ─── Replicate — concentric quarter-arcs (inference layers) ───
  replicate: "M4 19 L4 15 L8 15 L8 19 Z M4 14 L4 8 L10 8 L10 14 Z M4 7 L4 4 L14 4 L14 7 Z",

  // ─── Braintrust — layered triangles (eval stack) ───
  braintrust: "M12 3 L22 19 L2 19 Z M12 8 L18.5 17.5 L5.5 17.5 Z M12 13 L15 17 L9 17 Z",
};
