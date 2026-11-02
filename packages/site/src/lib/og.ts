/**
 * Open Graph / Twitter card helpers.
 *
 * We ship a base SVG at /og.svg that looks great on its own. For per-page cards
 * (docs, blog posts) callers pass a title and get back the meta tag set they
 * should render.
 *
 * Social cards are PNG so Facebook, LinkedIn, and other previewers that skip
 * SVG still get an image. The SVG originals stay in public/ for browsers.
 * Pass `ogImage` to override the default card.
 */

export const SITE_URL = "https://stack.ashlr.ai";
/** One public URL for each page, independent of request query strings. */
export function canonicalUrl(path: string): string {
  const url = new URL(path, SITE_URL);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export const SITE_NAME = "Ashlr Stack";
export const TWITTER_HANDLE = "@ashlrai";
export const DEFAULT_OG_IMAGE = "/og.png";
export const DEFAULT_TWITTER_IMAGE = "/twitter-card.png";

export const DEFAULT_TITLE = "Ashlr Stack: the control plane for your entire dev stack";
export const DEFAULT_DESCRIPTION =
  "Plan and configure supported services for a local development project, using Stack CLI workflows and its MCP bridge.";

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
  const canonical = input.canonical ?? `${SITE_URL}/`;
  const imageAlt =
    input.imageAlt ??
    "Ashlr Stack orange Orbit and Spire mark with an illustrative Stack workflow. Credentials and client setup are still required.";

  return [
    { attr: "property", key: "og:site_name", value: SITE_NAME },
    { attr: "property", key: "og:locale", value: "en_US" },
    { attr: "property", key: "og:type", value: ogType },
    { attr: "property", key: "og:url", value: canonical },
    { attr: "property", key: "og:title", value: title },
    { attr: "property", key: "og:description", value: description },
    { attr: "property", key: "og:image", value: ogImage },
    { attr: "property", key: "og:image:type", value: "image/png" },
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
  return `${SITE_URL}/${pathOrUrl}`;
}

/**
 * Returns the shared PNG card. Per-page title overlays are not generated.
 */
export function stampOgImage(_title: string): string {
  return DEFAULT_OG_IMAGE;
}
