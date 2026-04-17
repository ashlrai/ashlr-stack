/**
 * Sidebar structure for the /docs section.
 *
 * Each group renders a heading + its items. The `href` is the canonical URL
 * for the page; the sidebar highlights the group whose href matches the
 * current pathname.
 */

export interface DocsNavItem {
  label: string;
  href: string;
  /** Short one-liner shown on the docs home cards — NOT in the sidebar. */
  blurb?: string;
}

export interface DocsNavGroup {
  title: string;
  items: DocsNavItem[];
}

export const DOCS_NAV: DocsNavGroup[] = [
  {
    title: "Getting started",
    items: [
      { label: "Introduction", href: "/docs/", blurb: "What Stack is, and what it isn't." },
      {
        label: "Quickstart",
        href: "/docs/quickstart/",
        blurb: "From zero to `stack add supabase` in five minutes.",
      },
    ],
  },
  {
    title: "Reference",
    items: [
      {
        label: "CLI reference",
        href: "/docs/cli/",
        blurb: "Every `stack` command: synopsis, flags, and examples.",
      },
      {
        label: "Config (.stack.toml)",
        href: "/docs/config/",
        blurb: "The schema, the two-file split, and what's safe to commit.",
      },
      {
        label: "Providers",
        href: "/docs/providers/",
        blurb: "The 23 curated providers — auth, secrets, MCP wiring.",
      },
      {
        label: "Templates",
        href: "/docs/templates/",
        blurb: "Five starter stacks you can apply with one command.",
      },
    ],
  },
  {
    title: "Integrations",
    items: [
      {
        label: "Phantom Secrets",
        href: "/docs/phantom/",
        blurb: "Why Stack doesn't store secrets — and where they actually live.",
      },
      {
        label: "MCP (Claude, Cursor)",
        href: "/docs/mcp/",
        blurb: "Drive Stack from an LLM editor via MCP tools.",
      },
      {
        label: "CI",
        href: "/docs/ci/",
        blurb: "Run `stack doctor --json` on every push, with Phantom Cloud.",
      },
    ],
  },
  {
    title: "Help",
    items: [
      {
        label: "FAQ",
        href: "/docs/faq/",
        blurb: "Top questions a new user will ask in the first hour.",
      },
    ],
  },
];

/** Flat list of all pages, in sidebar order — used for prev/next navigation. */
export const DOCS_PAGES: DocsNavItem[] = DOCS_NAV.flatMap((g) => g.items);

export function findPageByHref(href: string): DocsNavItem | undefined {
  const normalized = href.endsWith("/") ? href : `${href}/`;
  return DOCS_PAGES.find((p) => p.href === normalized);
}

export function neighboursOf(
  href: string,
): { prev?: DocsNavItem; next?: DocsNavItem } {
  const normalized = href.endsWith("/") ? href : `${href}/`;
  const idx = DOCS_PAGES.findIndex((p) => p.href === normalized);
  if (idx === -1) return {};
  return {
    prev: idx > 0 ? DOCS_PAGES[idx - 1] : undefined,
    next: idx < DOCS_PAGES.length - 1 ? DOCS_PAGES[idx + 1] : undefined,
  };
}
