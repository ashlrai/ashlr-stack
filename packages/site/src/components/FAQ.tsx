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
    a: "Stack coordinates provider login, resource creation or attachment, secret storage and MCP wiring. The add workflow writes secrets through Phantom and records Stack/MCP configuration. Run `stack env export --example` separately to create an .env.example skeleton with empty values; this does not export plaintext credentials.",
  },
  {
    tag: "security",
    q: "How does Stack handle secrets? Does it ever hold them in memory?",
    a: "Yes. Stack temporarily handles login credentials and materialized secret values in process memory during setup. Persistent values are stored through Phantom; Stack configuration records secret names, resource references and provider metadata. Provider errors and subprocess output can still contain sensitive information, so this is not a guarantee of global redaction.",
  },
  {
    tag: "comparison",
    q: "How is this different from Doppler, Infisical, 1Password secrets?",
    a: "Stack coordinates provisioning and configuration around a secret manager. Its adapters can create or attach Supabase and Vercel projects, or read a DSN from an existing Sentry project. Vercel expects a user-supplied token; Supabase and GitHub have OAuth paths when configured, with PAT fallbacks. Authentication and resource operations depend on the adapter.",
  },
  {
    tag: "agent",
    q: "Which AI clients / IDEs does Stack work with?",
    a: "Stack includes a CLI, a Claude Code plugin and an MCP server. Other clients need compatible MCP configuration; a shared file alone does not establish client support. For local commands, `stack exec -- <command>` forwards execution to Phantom. The .env.example export is an empty-value skeleton, not automatic framework configuration.",
  },
  {
    tag: "lock-in",
    q: "What happens if I stop using Stack?",
    a: "Provider resources and the Phantom vault are separate from Stack. Local Stack files describe services and resource references, while .mcp.json contains MCP configuration. Removing Stack does not convert Phantom references into literal credentials. `stack env export --example` writes an empty-value example file, not a plaintext migration or a managed block in .env.local.",
  },
  {
    tag: "scope",
    q: "Which workflows does the source implement?",
    a: "The repository contains provider adapters, CLI workflows, a Claude Code plugin, an MCP server and starter templates. Some adapters create resources; others attach to an account or validate an existing key. OAuth requires the relevant client configuration. Check your installed version's help for its available commands; source capabilities do not establish a published release or provider activation.",
  },
  {
    tag: "cost",
    q: "What does Stack cost?",
    a: "Stack's code is MIT-licensed. Provider accounts and any separate Phantom service have their own terms and charges. A free CLI does not make the resources you provision free; check the provider's terms before creating them.",
  },
  {
    tag: "contrib",
    q: "Can I add a provider that isn't in the catalog?",
    a: "Yes. Adapters implement the Provider interface in packages/core/src/providers/_base.ts, including login, provision and materialize. Register the adapter in packages/core/src/providers/index.ts and add focused tests. Health checks, dashboard links and resource teardown are optional capabilities, so document which operations the adapter supports.",
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
          <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-blade-400)] shrink-0 mt-1 min-w-[72px]">
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
