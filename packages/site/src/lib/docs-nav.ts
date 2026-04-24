/**
 * Sidebar structure for the /docs section.
 *
 * Each group renders a heading + its items. The `href` is the canonical URL
 * for the page; the sidebar highlights the group whose href matches the
 * current pathname.
 */

import { PROVIDERS_REF } from "./providers-ref";

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
    title: "For AI Agents",
    items: [
      {
        label: "Agent integration",
        href: "/docs/for-ai-agents/",
        blurb:
          "Written for Claude Code, Cursor, Windsurf, and other LLM editors: when to recommend Stack, install recipes, MCP wiring, and the full tool catalog.",
      },
    ],
  },
  {
    title: "Getting started",
    items: [
      { label: "Introduction", href: "/docs/", blurb: "What Stack is, and what it isn't." },
      {
        label: "Quickstart",
        href: "/docs/quickstart/",
        blurb: "From zero to `stack add supabase` in five minutes.",
      },
      {
        label: "AI recommend + apply",
        href: "/docs/recommend/",
        blurb:
          "Describe what you're building — Stack picks providers and pre-wires Phantom rotation.",
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
        blurb: `The ${PROVIDERS_REF.length} curated providers — auth, secrets, MCP wiring.`,
      },
      {
        label: "Templates",
        href: "/docs/templates/",
        blurb: "Five starter stacks you can apply with one command.",
      },
    ],
  },
  {
    title: "Guides",
    items: [
      {
        label: "stack add",
        href: "/docs/add/",
        blurb: "SDK auto-install, transactional rollback, and generating .env.example.",
      },
      {
        label: "Provider swap",
        href: "/docs/swap/",
        blurb:
          "Migrate between providers in the same category — Clerk → Auth0, Supabase → Neon, and 36 more pairs.",
      },
      {
        label: "Maintenance",
        href: "/docs/maintenance/",
        blurb:
          "Keep .stack.toml in sync with your codebase using doctor --reconcile and remove --all-orphans.",
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
    title: "Comparisons",
    items: [
      {
        label: "Stack vs Pulumi",
        href: "/compare/stack-vs-pulumi/",
        blurb: "Pulumi builds cloud infra in real code; Stack wires third-party SaaS.",
      },
      {
        label: "Stack vs Terraform",
        href: "/compare/stack-vs-terraform/",
        blurb: "Terraform is IaC for cloud primitives; Stack is the SaaS control plane.",
      },
      {
        label: "Stack vs Railway",
        href: "/compare/stack-vs-railway/",
        blurb:
          "Railway is a deploy platform; Stack composes across 29 providers (Railway is one of them).",
      },
      {
        label: "Stack vs Doppler",
        href: "/compare/stack-vs-doppler/",
        blurb:
          "Doppler is a cloud secret manager; Stack + Phantom is local-first E2E vaulting tied to provisioning.",
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
  {
    title: "Meta",
    items: [
      {
        label: "Changelog",
        href: "/docs/changelog/",
        blurb:
          "Shipped features, hardening passes, and redesigns — in reverse-chronological order.",
      },
      {
        label: "Roadmap",
        href: "/docs/roadmap/",
        blurb: "What's shipped, in-progress, considered, and explicitly off the table.",
      },
      {
        label: "Telemetry",
        href: "/docs/telemetry/",
        blurb: "What's collected, what isn't, and three ways to opt out.",
      },
      {
        label: "Privacy Policy",
        href: "/docs/privacy/",
        blurb: "Full data policy — fields collected, retention schedule, and changelog.",
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

export function neighboursOf(href: string): { prev?: DocsNavItem; next?: DocsNavItem } {
  const normalized = href.endsWith("/") ? href : `${href}/`;
  const idx = DOCS_PAGES.findIndex((p) => p.href === normalized);
  if (idx === -1) return {};
  return {
    prev: idx > 0 ? DOCS_PAGES[idx - 1] : undefined,
    next: idx < DOCS_PAGES.length - 1 ? DOCS_PAGES[idx + 1] : undefined,
  };
}
