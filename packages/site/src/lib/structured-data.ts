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

import { QUESTIONS } from "~/components/FAQ";
import cliPackage from "../../../cli/package.json";
import { SITE_NAME, SITE_URL } from "./og";
import { PROVIDERS_REF } from "./providers-ref";

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
      url: `${SITE_URL}/icon-512.svg`,
      width: 512,
      height: 512,
    },
    sameAs: ["https://github.com/ashlrai", "https://github.com/ashlrai/ashlr-stack"],
  };
}

export function websiteSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description:
      "Ashlr Stack offers a local CLI, stdio MCP bridge and Claude Code plugin for planning and configuring supported project services.",
    publisher: { "@id": "https://ashlr.ai/#organization" },
    inLanguage: "en-US",
  };
}

export function softwareApplicationSchema(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#software`,
    name: SITE_NAME,
    alternateName: "Stack",
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "DevOps Tool",
    operatingSystem: "macOS, Linux, Windows",
    url: SITE_URL,
    description: `The reviewed catalog lists ${PROVIDERS_REF.length} provider entries. Stack offers CLI workflows and a stdio MCP bridge for local project setup; authentication, resource and client results depend on each adapter.`,
    softwareVersion: cliPackage.version,
    codeRepository: "https://github.com/ashlrai/ashlr-stack",
    downloadUrl: `${SITE_URL}/docs/capabilities`,
    license: `https://spdx.org/licenses/${cliPackage.license}.html`,
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
      `Curated source metadata for ${PROVIDERS_REF.length} provider entries`,
      "Provider-specific OAuth, PAT or API-key setup",
      "Credential persistence through Phantom; setup processes still handle values",
      "Explicit .env.example empty-key export and optional MCP configuration",
      "Claude Code plugin with /stack:add, /stack:doctor, /stack:list",
      "Source stdio MCP bridge: 19 CLI-backed tools and up to 3 conditional raw-file resources",
      "Templated starters: Next.js + Supabase + PostHog, Cloudflare + Turso + Clerk, etc.",
      "stack scan detects existing services in a repo",
      "stack doctor --fix attempts supported repairs; failures and skips remain visible",
      "MCP client setup depends on CLI/server runtime, working directory and credentials",
    ],
  };
}

/** FAQPage schema generated from the live FAQ component's QUESTIONS array. */
export function homepageFaqSchema(): Record<string, unknown> {
  return faqPageSchema(
    QUESTIONS.map((q) => ({ question: q.q, answer: q.a })),
    `${SITE_URL}/#faq`,
  );
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
  return `${SITE_URL}/${pathOrUrl}`;
}

/**
 * Convenience: the default schema set emitted on the homepage.
 */
export function homepageSchemas(): Record<string, unknown>[] {
  return [
    organizationSchema(),
    websiteSchema(),
    softwareApplicationSchema(),
    homepageFaqSchema(),
    breadcrumbSchema([{ name: "Home", url: "/" }]),
  ];
}

// ───────────────────────────────────────────────────────────────────────────
// Docs-page schema helpers
//
// These emit rich structured data for each /docs page so that:
//   - Google can surface "table of contents" rich results against H2 anchors
//   - AI crawlers + LLMs (Claude, Perplexity, ChatGPT) can cleanly parse page
//     structure and purpose
//   - The article graph carries author / dates / canonical URL
//
// Every helper returns a plain JSON-LD object that Base.astro emits inside a
// <script type="application/ld+json"> tag. No side effects.
// ───────────────────────────────────────────────────────────────────────────

export interface TechArticleInput {
  headline: string;
  description?: string;
  /** Full canonical URL of the page. */
  url: string;
  /** ISO-8601 date string. */
  datePublished?: string | null;
  /** ISO-8601 date string. */
  dateModified?: string | null;
  /** Section label (e.g. "Reference", "Getting started"). Optional. */
  section?: string;
}

export function techArticleSchema(input: TechArticleInput): Record<string, unknown> {
  // Explicit null omits unknown dates on new guides instead of backdating them.
  const datePublished =
    input.datePublished === null ? undefined : (input.datePublished ?? "2026-04-17");
  const dateModified =
    input.dateModified === null ? undefined : (input.dateModified ?? datePublished);
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: input.headline,
    name: input.headline,
    description: input.description,
    url: input.url,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": input.url,
    },
    datePublished,
    dateModified,
    inLanguage: "en-US",
    author: { "@id": "https://ashlr.ai/#organization" },
    publisher: { "@id": "https://ashlr.ai/#organization" },
    isPartOf: { "@id": `${SITE_URL}/#website` },
  };
  if (input.section) {
    schema.articleSection = input.section;
  }
  // Strip undefined values so JSON output stays tidy.
  for (const key of Object.keys(schema)) {
    if (schema[key] === undefined) delete schema[key];
  }
  return schema;
}

export interface HowToStep {
  name: string;
  text: string;
  url?: string;
}

export interface HowToInput {
  name: string;
  description?: string;
  totalTime?: string; // ISO 8601 duration, e.g. "PT5M"
  steps: HowToStep[];
  url: string;
}

export function howToSchema(input: HowToInput): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: input.name,
    description: input.description,
    totalTime: input.totalTime,
    url: input.url,
    mainEntityOfPage: { "@type": "WebPage", "@id": input.url },
    step: input.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
      url: s.url ?? `${input.url}#step-${i + 1}`,
    })),
  };
  for (const key of Object.keys(schema)) {
    if (schema[key] === undefined) delete schema[key];
  }
  return schema;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqPageSchema(items: FaqItem[], url?: string): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: it.answer,
      },
    })),
  };
  if (url) {
    schema.url = url;
    schema.mainEntityOfPage = { "@type": "WebPage", "@id": url };
  }
  return schema;
}

export interface ItemListEntry {
  /** Usually a kebab-case id or name. */
  name: string;
  /** Free-form description. */
  description?: string;
  /** Full URL (or anchor like `/docs/cli#init`). Can be absolute or site-root-relative. */
  url?: string;
  /** Optional schema sub-type, e.g. "SoftwareSourceCode". */
  type?: string;
  /** Additional key/value pairs merged into the ListItem.item object. */
  extra?: Record<string, unknown>;
}

export interface ItemListInput {
  name: string;
  description?: string;
  itemListOrder?: "Ascending" | "Descending" | "Unordered";
  items: ItemListEntry[];
  /** Canonical URL of the page this list lives on. */
  url?: string;
}

export function itemListSchema(input: ItemListInput): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: input.name,
    description: input.description,
    itemListOrder: `https://schema.org/ItemListOrder${input.itemListOrder ?? "Ascending"}`,
    numberOfItems: input.items.length,
    itemListElement: input.items.map((entry, idx) => {
      const item: Record<string, unknown> = {
        "@type": entry.type ?? "Thing",
        name: entry.name,
      };
      if (entry.description) item.description = entry.description;
      if (entry.url) item.url = absolute(entry.url);
      if (entry.extra) Object.assign(item, entry.extra);
      return {
        "@type": "ListItem",
        position: idx + 1,
        item,
      };
    }),
  };
  if (input.url) {
    schema.url = input.url;
    schema.mainEntityOfPage = { "@type": "WebPage", "@id": input.url };
  }
  for (const key of Object.keys(schema)) {
    if (schema[key] === undefined) delete schema[key];
  }
  return schema;
}
