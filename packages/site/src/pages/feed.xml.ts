import type { APIContext } from "astro";
import { DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL } from "~/lib/og";

/**
 * Minimal RSS 2.0 feed for stack.ashlr.ai.
 *
 * Sourced from the three launch posts in src/pages/launch/* rather than a
 * content collection — there's nothing else to feed yet and adding
 * @astrojs/rss + a collection for 3 posts isn't worth the build-time cost.
 * When we start publishing changelog entries or blog posts on a cadence,
 * swap this for a getCollection()-backed generator.
 */

interface Entry {
  title: string;
  slug: string;
  description: string;
  pubDate: string; // RFC 822
}

const ENTRIES: Entry[] = [
  {
    title: "Introducing Ashlr Stack",
    slug: "launch/blog",
    description:
      "The control plane for your entire dev stack — one command to provision, wire, and operate every third-party service in a project.",
    pubDate: "Fri, 18 Apr 2026 00:00:00 +0000",
  },
  {
    title: "Ashlr Stack on HN",
    slug: "launch/hn",
    description: "Show HN version of the launch post, tighter framing.",
    pubDate: "Fri, 18 Apr 2026 00:00:00 +0000",
  },
  {
    title: "Ashlr Stack launch thread",
    slug: "launch/twitter",
    description: "Twitter/X thread version of the launch.",
    pubDate: "Fri, 18 Apr 2026 00:00:00 +0000",
  },
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(_: APIContext): Promise<Response> {
  const items = ENTRIES.map((e) => {
    const link = `${SITE_URL}/${e.slug}/`;
    return `
    <item>
      <title>${escapeXml(e.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${e.pubDate}</pubDate>
      <description>${escapeXml(e.description)}</description>
    </item>`;
  }).join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${SITE_URL}</link>
    <description>${escapeXml(DEFAULT_DESCRIPTION)}</description>
    <language>en-us</language>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />${items}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
}
