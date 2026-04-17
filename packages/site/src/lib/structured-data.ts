/**
 * JSON-LD schema generators for SEO + rich result eligibility.
 *
 * Keep these honest:
 *   - No invented ratings (pre-alpha, no real userbase yet).
 *   - No fabricated review counts.
 *   - Only include fields we can back up today.
 *
 * Output is stringified and emitted via <script type="application/ld+json">.
 */

import { SITE_NAME, SITE_URL } from "./og";

export interface BreadcrumbItem {
  name: string;
  url: string; // absolute or site-root-relative
}

export function organizationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": "https://ashlr.ai/#organization",
    name: "Ashlr",
    url: "https://ashlr.ai",
    logo: {
      "@type": "ImageObject",
      url: SITE_URL + "/icon-512.svg",
      width: 512,
      height: 512,
    },
    sameAs: [
      "https://github.com/ashlrai",
    ],
  };
}

export function websiteSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": SITE_URL + "/#website",
    url: SITE_URL,
    name: SITE_NAME,
    description:
      "Ashlr Stack is a CLI, MCP server, and Claude Code plugin that provisions, wires, and operates every third-party service in your dev project with one command.",
    publisher: { "@id": "https://ashlr.ai/#organization" },
    inLanguage: "en-US",
  };
}

export function softwareApplicationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": SITE_URL + "/#software",
    name: SITE_NAME,
    alternateName: "Stack",
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "DevOps Tool",
    operatingSystem: "macOS, Linux, Windows",
    url: SITE_URL,
    description:
      "The control plane for your entire dev stack. One command to provision, wire, and operate every third-party service in a project. Ships as a CLI, an MCP server, and a Claude Code plugin. Supports 23 providers across databases, deploy targets, cloud, AI, analytics, errors, payments, code hosting, tickets, email, and auth.",
    softwareVersion: "0.1.0-pre-alpha",
    license: "https://opensource.org/licenses/MIT",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    author: { "@id": "https://ashlr.ai/#organization" },
    publisher: { "@id": "https://ashlr.ai/#organization" },
    keywords: [
      "developer tools",
      "CLI",
      "MCP",
      "Model Context Protocol",
      "Claude Code",
      "secrets management",
      "infrastructure provisioning",
      "devops",
      "OAuth automation",
    ].join(", "),
    featureList: [
      "One-command provisioning across 23 third-party services",
      "OAuth dance handled automatically per provider",
      "Secrets written through Phantom (never leak to disk)",
      "Generates .env and .mcp.json",
      "Claude Code plugin with /stack:add, /stack:doctor, /stack:open",
      "MCP server exposes every command as a tool",
      "Templated starters: Next.js + Supabase + PostHog, Cloudflare + Turso + Clerk, etc.",
      "stack scan detects existing services in a repo",
      "stack doctor --fix re-provisions broken services",
    ],
  };
}

export function breadcrumbSchema(items: BreadcrumbItem[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absolute(item.url),
    })),
  };
}

function absolute(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith("/")) return SITE_URL + pathOrUrl;
  return SITE_URL + "/" + pathOrUrl;
}

/**
 * Convenience: the default schema set emitted on the homepage.
 */
export function homepageSchemas(): Record<string, unknown>[] {
  return [organizationSchema(), websiteSchema(), softwareApplicationSchema()];
}
