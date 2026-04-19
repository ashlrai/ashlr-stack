import { useState } from "react";
import { linkifyPhantom } from "~/lib/phantom-link";

/**
 * FAQ — collapsible objection-addressing section.
 *
 * Content hand-written to front-load the concerns a developer will actually
 * have before adopting Stack: secret handling, lock-in, how it differs from
 * dotenv/Doppler, open-source posture, which agents it supports.
 */

interface Q {
  q: string;
  a: string;
  tag?: string;
}

export const QUESTIONS: Q[] = [
  {
    tag: "model",
    q: "Isn't this just a fancy .env file?",
    a: "No — .env is the last step. Stack owns everything before: the provider-side OAuth, the upstream resource creation, the secret rotation surface. .env is where Stack *publishes* the result, but the secret value lives only in Phantom's E2E-encrypted vault. If you rotate a key in Phantom, every consumer (your dev server, your agent, CI) sees the new value on the next read — no file edits, no commits.",
  },
  {
    tag: "security",
    q: "How does Stack handle secrets? Does it ever hold them in memory?",
    a: "Stack holds slot names (phantom://supabase/SUPABASE_URL), not values. The CLI shells out to the Phantom binary whenever a value needs to be materialised, and the materialisation is scoped to a single subprocess call (stack exec -- …). The agent-facing MCP server is configured with the slot names; values are fetched per-tool-call, never cached. Stack's own code has no code path that can leak a secret outside the subprocess that asked for it.",
  },
  {
    tag: "comparison",
    q: "How is this different from Doppler, Infisical, 1Password secrets?",
    a: "Those are pure secret managers. Stack is a thin coordinator on top of one: you use Phantom for storage, Stack for the provisioning + wiring workflow. Stack can provision a new Supabase project, a new Vercel token, a new Sentry DSN — not just store one you already have. The MCP integration is also specific: Stack wires .mcp.json so your Claude Code session sees a consistent stack without manual copy-paste.",
  },
  {
    tag: "agent",
    q: "Which AI clients / IDEs does Stack work with?",
    a: "Claude Code is the primary surface (first-party plugin + MCP server). Anything that reads a standard .mcp.json — Cursor, Windsurf, Zed's AI panel, the Codex CLI, any Anthropic SDK client — picks up the same configuration. The .env side is framework-agnostic: Next.js, Bun, Deno, Rails, Django all read it the same way.",
  },
  {
    tag: "lock-in",
    q: "What happens if I stop using Stack?",
    a: "Your .env.local and .mcp.json are normal files. If you delete Stack, those files keep working — you'll just have raw phantom:// slots in .env that your shell won't resolve. Running `phantom export > .env.local` materialises every slot into literal values, at which point you can walk away with a conventional .env file and no trace of Stack left. Stack writes a managed block with `# Ashlr Stack — managed block` markers so unmanaged lines are never touched.",
  },
  {
    tag: "scope",
    q: "What's in v0.1 today vs later?",
    a: "v0.1: the 26 providers in the catalog above, the CLI (22 commands), the Claude Code plugin, the MCP server, 5 starter templates. Full OAuth provisioning ships for Supabase + GitHub + Vercel + Cloudflare; the rest are API-key paste flows. Roadmap: Stripe Connect, AWS IAM role-chaining, an Ashlr-hosted control plane for team sync. Everything is MIT-licensed on GitHub.",
  },
  {
    tag: "cost",
    q: "What does Stack cost?",
    a: "Stack is free and MIT-licensed. Phantom has a free tier for local-only vaults; Phantom Cloud (the team-sync surface) is paid but not required. Every underlying provider is billed by the provider — Stack doesn't mark anything up. The hosted control plane (coming soon) will have a free tier for solo developers.",
  },
  {
    tag: "contrib",
    q: "Can I add a provider that isn't in the catalog?",
    a: "Yes. Provider adapters live in packages/core/src/providers/*.ts and are a single file each — three exports: authKind, secrets[], and provision(ctx). The README walks through adding a new one in under 50 lines. PRs welcome.",
  },
];

function Row({ q, idx }: { q: Q; idx: number }) {
  const [open, setOpen] = useState(idx === 0);
  return (
    <div className="border-t border-[color:var(--color-ink-600)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left py-5 flex items-start gap-4 group"
        aria-expanded={open}
      >
        {q.tag && (
          <span
            className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-blade-400)] shrink-0 mt-1 min-w-[72px]"
          >
            {q.tag}
          </span>
        )}
        <span className="flex-1 text-[15px] sm:text-[16px] text-[color:var(--color-ink-100)] tracking-tight font-medium">
          {q.q}
        </span>
        <span
          className="mono text-[14px] text-[color:var(--color-ink-400)] group-hover:text-[color:var(--color-blade-400)] transition-colors shrink-0"
          aria-hidden="true"
          style={{ transform: open ? "rotate(45deg)" : "none", transition: "transform 220ms ease" }}
        >
          +
        </span>
      </button>
      <div
        className="overflow-hidden transition-[max-height] duration-300"
        style={{ maxHeight: open ? "400px" : "0px" }}
      >
        <p className="pb-5 pl-[88px] sm:pl-[88px] pr-8 text-[14px] leading-[1.7] text-[color:var(--color-ink-300)] max-w-[780px]">
          {linkifyPhantom(q.a)}
        </p>
      </div>
    </div>
  );
}

export default function FAQ() {
  return (
    <div>
      {QUESTIONS.map((q, i) => (
        <Row key={q.q} q={q} idx={i} />
      ))}
    </div>
  );
}
