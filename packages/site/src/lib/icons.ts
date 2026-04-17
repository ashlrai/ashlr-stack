// Lazy helper to load a simple-icons SVG path at build time.
// We inline <path d="…"/> and render it ourselves — this avoids the <title>
// element + role="img" from the upstream SVG and lets us control sizing/color
// cleanly from parent styles.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = resolve(__dirname, "..", "..", "node_modules", "simple-icons", "icons");

const pathCache = new Map<string, string>();

/** Returns the value of the `d` attribute of the first <path> in a simple-icons SVG. */
export function getIconPath(slug: string): string | null {
  if (pathCache.has(slug)) return pathCache.get(slug)!;
  const file = resolve(ICONS_DIR, `${slug}.svg`);
  if (!existsSync(file)) {
    return CUSTOM_ICON_PATHS[slug] ?? null;
  }
  const raw = readFileSync(file, "utf8");
  const match = raw.match(/<path[^>]*\sd="([^"]+)"/);
  if (!match) return null;
  pathCache.set(slug, match[1]!);
  return match[1]!;
}

// Fallbacks for providers with no simple-icons entry.
// Simplified geometric marks — recognizable but not claiming to be the official wordmark.
export const CUSTOM_ICON_PATHS: Record<string, string> = {
  // Convex — four chevrons forming a diamond (abstracted)
  convex:
    "M12 2 L22 12 L12 22 L2 12 Z M12 6 L18 12 L12 18 L6 12 Z",
  // DeepSeek — stylized whale silhouette reduced to a wave + dot
  deepseek:
    "M4 14 C 7 10, 11 10, 14 13 C 16 15, 19 15, 22 13 L 22 17 C 19 19, 15 19, 12 17 C 9 15, 6 15, 4 17 Z M17 9 a1.3 1.3 0 1 1 0.01 0 Z",
};
