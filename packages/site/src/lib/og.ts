/**
 * Open Graph / Twitter card helpers.
 *
 * We ship a base SVG at /og.svg that looks great on its own. For per-page cards
 * (docs, blog posts) callers pass a title and get back the meta tag set they
 * should render.
 *
 * Rasterization caveat: SVG OG images are accepted by most modern crawlers
 * (Discord, Slack, iMessage) but some legacy previewers — notably older
 * Facebook scrapers and some LinkedIn surfaces — still require PNG. In a real
 * deploy, run an asset pipeline (sharp / resvg / satori) against these SVGs
 * and emit `.png` siblings; this module accepts an `ogImage` override so the
 * pipeline can point at the rasterized variant.
 */

export const SITE_URL = "https://stack.ashlr.ai";
export const SITE_NAME = "Ashlr Stack";
export const TWITTER_HANDLE = "@ashlrai";
export const DEFAULT_OG_IMAGE = "/og.svg";
export const DEFAULT_OG_IMAGE_PNG = "/og.png"; // rasterize in deploy pipeline
export const DEFAULT_TWITTER_IMAGE = "/twitter-card.svg";

export const DEFAULT_TITLE = "Ashlr Stack — The control plane for your entire dev stack";
export const DEFAULT_DESCRIPTION =
  "One command to provision, wire, and operate every third-party service in your project. 29 providers. CLI + MCP + Claude Code plugin.";

export interface OgMetaInput {
  title?: string;
  description?: string;
  /** Absolute or site-root-relative URL for the OG image. */
  ogImage?: string;
  /** Absolute or site-root-relative URL for the Twitter image. Falls back to ogImage. */
  twitterImage?: string;
  /** og:type — "website" for marketing pages, "article" for blog posts. */
  ogType?: "website" | "article" | "profile";
  /** Full URL used for canonical + og:url. */
  canonical?: string;
  /** Short alt text for the OG image. Screen readers + SEO. */
  imageAlt?: string;
}

export interface OgMetaTag {
  /** HTML attribute used (property vs name). */
  attr: "property" | "name";
  key: string;
  value: string;
}

/**
 * Returns a structured list of meta tags for the requested page. Consumers
 * render these directly; they don't need to know the attribute rules.
 */
export function buildOgMeta(input: OgMetaInput = {}): OgMetaTag[] {
  const title = input.title ?? DEFAULT_TITLE;
  const description = input.description ?? DEFAULT_DESCRIPTION;
  const ogImage = absolute(input.ogImage ?? DEFAULT_OG_IMAGE);
  const twitterImage = absolute(input.twitterImage ?? input.ogImage ?? DEFAULT_TWITTER_IMAGE);
  const ogType = input.ogType ?? "website";
  const canonical = input.canonical ?? SITE_URL + "/";
  const imageAlt = input.imageAlt ?? "Ashlr Stack — dark terminal with magenta triangle logo and the tagline 'The control plane for your entire dev stack.'";

  return [
    { attr: "property", key: "og:site_name", value: SITE_NAME },
    { attr: "property", key: "og:locale", value: "en_US" },
    { attr: "property", key: "og:type", value: ogType },
    { attr: "property", key: "og:url", value: canonical },
    { attr: "property", key: "og:title", value: title },
    { attr: "property", key: "og:description", value: description },
    { attr: "property", key: "og:image", value: ogImage },
    { attr: "property", key: "og:image:alt", value: imageAlt },
    { attr: "property", key: "og:image:width", value: "1200" },
    { attr: "property", key: "og:image:height", value: "630" },
    { attr: "name", key: "twitter:card", value: "summary_large_image" },
    { attr: "name", key: "twitter:site", value: TWITTER_HANDLE },
    { attr: "name", key: "twitter:creator", value: TWITTER_HANDLE },
    { attr: "name", key: "twitter:title", value: title },
    { attr: "name", key: "twitter:description", value: description },
    { attr: "name", key: "twitter:image", value: twitterImage },
    { attr: "name", key: "twitter:image:alt", value: imageAlt },
  ];
}

function absolute(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith("/")) return SITE_URL + pathOrUrl;
  return SITE_URL + "/" + pathOrUrl;
}

/**
 * Placeholder for a future asset-pipeline hook. A real implementation would
 * rasterize /og.svg with a per-page title overlay and return the .png URL.
 * Today it simply returns the static /og.svg.
 */
export function stampOgImage(_title: string): string {
  return DEFAULT_OG_IMAGE;
}
