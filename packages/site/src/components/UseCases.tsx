import { useState } from "react";
import CopyBtn from "~/components/primitives/CopyBtn";

/**
 * UseCases — real Claude Code conversations alongside the exact `stack`
 * invocations they drive. Tabs across four canonical scenarios. Each
 * tab shows the chat turn, the CLI output it produces, and a copy-
 * able one-liner you can paste into your own terminal.
 */

interface TurnLine {
  kind: "user" | "assistant" | "tool" | "work" | "ok" | "dim";
  text: string;
  detail?: string;
}

interface UseCase {
  id: string;
  title: string;
  persona: string;
  command: string;
  ask: string;
  outcome: string;
  turns: TurnLine[];
}

const CASES: UseCase[] = [
  {
    id: "new-saas",
    title: "Spin up a new SaaS — zero to deployable",
    persona: "solo founder, new repo",
    command: "stack init --template saas && stack add supabase posthog sentry resend",
    ask: "Start a new SaaS: auth, Postgres, product analytics, error tracking, transactional email. Wire everything so I can `bun dev` in one minute.",
    outcome:
      "5 providers provisioned, 11 env vars in Phantom, 3 MCP servers wired. `.env.local` + `.mcp.json` are ready. Claude Code can now query the DB + tail Sentry without copy-paste.",
    turns: [
      {
        kind: "user",
        text: "Start a new SaaS project. I want Supabase for auth + DB, PostHog for analytics, Sentry for errors, Resend for email.",
      },
      {
        kind: "assistant",
        text: "I'll scaffold it with Stack's saas template and batch-add those four providers. One moment.",
      },
      { kind: "tool", text: "stack_init", detail: "template=saas" },
      { kind: "work", text: "scaffolded package.json + .stack.toml + .stack.local.toml" },
      { kind: "tool", text: "stack_add", detail: "supabase + posthog + sentry + resend" },
      {
        kind: "work",
        text: "Supabase · OAuth PKCE",
        detail: "project raven-prod · us-east-1 · 3 secrets → phantom",
      },
      {
        kind: "work",
        text: "PostHog · API key paste",
        detail: "POSTHOG_PERSONAL_API_KEY → phantom · MCP server registered",
      },
      {
        kind: "work",
        text: "Sentry · PAT",
        detail: "project raven · DSN fetched · MCP server registered",
      },
      {
        kind: "work",
        text: "Resend · API key paste",
        detail: "RESEND_API_KEY → phantom · domain verified",
      },
      { kind: "ok", text: "✓ 4 providers ready · 11 env vars · 3 MCP servers wired" },
      {
        kind: "assistant",
        text: "Done. `.env.local` resolves through Phantom; your Claude Code session will see the new MCP servers after a restart. Ready for `bun dev`.",
      },
    ],
  },
  {
    id: "add-analytics",
    title: "Add analytics to a repo already in production",
    persona: "1-person team, existing Next.js app",
    command: "stack add posthog",
    ask: "Wire PostHog into this existing app. Don't touch any of the Supabase secrets already in .env.",
    outcome:
      "PostHog key added to the Phantom-managed block of `.env.local` (never touching your unmanaged lines). `stack exec -- bun dev` resolves it at runtime. No other files modified.",
    turns: [
      {
        kind: "user",
        text: "Wire PostHog into this app. Don't touch the existing Supabase secrets.",
      },
      {
        kind: "assistant",
        text: "I'll add PostHog. Stack only patches its own managed block in .env.local — your Supabase lines are untouched.",
      },
      { kind: "tool", text: "stack_add", detail: "posthog" },
      { kind: "work", text: "auth · API key paste", detail: "pasted from Claude Code prompt" },
      {
        kind: "work",
        text: "verifying against /api/projects/@me",
        detail: "200 OK · user mason@evero-consulting.com",
      },
      { kind: "work", text: "writing POSTHOG_PERSONAL_API_KEY → phantom vault" },
      {
        kind: "work",
        text: "patching .env.local managed block",
        detail: "appended 1 line, left 14 unmanaged lines untouched",
      },
      {
        kind: "work",
        text: 'registering MCP server "posthog"',
        detail: "SSE at mcp.posthog.com/sse",
      },
      { kind: "ok", text: "✓ posthog ready · 1 env var · 1 MCP server" },
      {
        kind: "assistant",
        text: "PostHog is live. Import and `posthog.capture()` — and the MCP server means I can pull events back without you running commands.",
      },
    ],
  },
  {
    id: "rotate-key",
    title: "Rotate a compromised Sentry token",
    persona: "oncall, prod alert just fired",
    command: "phantom rotate SENTRY_AUTH_TOKEN && stack doctor",
    ask: "Sentry auth token leaked via a misconfigured CI log. Rotate + re-verify everything.",
    outcome:
      "Old token revoked at Sentry, new one generated + stored in Phantom. `.env.local` doesn't need to change (it references the slot, not the value). Every Claude Code session + dev server + CI job picks up the new value on next read.",
    turns: [
      {
        kind: "user",
        text: "Sentry auth token leaked in a CI log. Rotate it and confirm every consumer picks up the new value.",
      },
      {
        kind: "assistant",
        text: "Rotating via Phantom. `.env.local` and `.mcp.json` reference the slot name, not the value — so the rotation is transparent to consumers.",
      },
      { kind: "tool", text: "phantom_rotate", detail: "SENTRY_AUTH_TOKEN" },
      {
        kind: "work",
        text: "revoking old token at sentry.io",
        detail: "api token id: 4829-a1b2 · revoked",
      },
      { kind: "work", text: "minting new token", detail: "scopes: project:read project:write" },
      {
        kind: "work",
        text: "writing new value to phantom vault",
        detail: "rotation counter: 1 → 2",
      },
      { kind: "tool", text: "stack_doctor" },
      {
        kind: "work",
        text: "bun dev · reading .env",
        detail: "resolved SENTRY_AUTH_TOKEN via phantom — new value",
      },
      {
        kind: "work",
        text: 'MCP server "sentry" reconnected',
        detail: "auth ok · no user-facing restart needed",
      },
      { kind: "ok", text: "✓ rotated · 0 files modified · all consumers live" },
      {
        kind: "assistant",
        text: "Rotated. Nothing was committed — the leaked token is dead, the new one is in Phantom, and every tool downstream has the new value now.",
      },
    ],
  },
  {
    id: "compare-providers",
    title: '"Which database should I use?" — agent knows the catalog',
    persona: "new project, researching",
    command: "stack providers database",
    ask: "I need a serverless Postgres. Walk me through the tradeoffs between the Stack-supported options.",
    outcome:
      "Claude reads the PROVIDERS_REF catalog via MCP, filters to Database providers, and lays out the 6 options with their auth method + provisioning behaviour. No tabs, no docs-hunting.",
    turns: [
      {
        kind: "user",
        text: "I need a serverless Postgres for a side project. What does Stack support and what are the tradeoffs?",
      },
      {
        kind: "assistant",
        text: "Pulling the catalog via the MCP resource — these are the 6 Database providers Stack ships today, with how Stack authenticates + provisions each.",
      },
      { kind: "tool", text: "stack_providers", detail: "category=database" },
      {
        kind: "work",
        text: "supabase",
        detail: "OAuth PKCE · Stack creates a project + fetches url/anon/service keys",
      },
      {
        kind: "work",
        text: "neon",
        detail: "PAT paste · Stack creates a project + returns DATABASE_URL",
      },
      { kind: "work", text: "turso", detail: "platform token paste · Stack creates a libSQL db" },
      {
        kind: "work",
        text: "convex",
        detail: "deploy-key paste · stored only, no upstream provisioning",
      },
      { kind: "work", text: "upstash", detail: "management-token paste · stored only" },
      { kind: "work", text: "firebase", detail: "service-account JSON paste · stored only" },
      {
        kind: "assistant",
        text: "For a solo side project I'd pick Neon (simplest PAT, branchy dev) or Supabase (fullest provisioning, auth + storage included). Want me to run `stack add neon`?",
      },
    ],
  },
];

function Turn({ line }: { line: TurnLine }) {
  if (line.kind === "user" || line.kind === "assistant") {
    const isUser = line.kind === "user";
    return (
      <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
        <div
          className={`max-w-[82%] p-3 ${isUser ? "bg-[color:var(--color-ink-700)]" : ""}`}
          style={{
            borderLeft: isUser ? "none" : "2px solid var(--color-blade-500)",
            borderRight: isUser ? "2px solid var(--color-steel-500)" : "none",
            backgroundColor: isUser ? "rgba(29, 44, 58, 0.7)" : "rgba(15, 17, 22, 0.85)",
          }}
        >
          <div className="mono text-[9px] tracking-[0.16em] uppercase text-[color:var(--color-ink-500)] mb-1">
            {isUser ? "you" : "claude code"}
          </div>
          <div className="text-[13px] text-[color:var(--color-ink-100)] leading-[1.55]">
            {line.text}
          </div>
        </div>
      </div>
    );
  }
  const colorClass =
    line.kind === "tool"
      ? "text-[color:var(--color-blade-400)]"
      : line.kind === "work"
        ? "text-[color:var(--color-ink-100)]"
        : line.kind === "ok"
          ? "text-[color:var(--color-signal-ok,#6fe8a7)]"
          : "text-[color:var(--color-ink-400)]";
  const prefix =
    line.kind === "tool" ? "→ " : line.kind === "work" ? "✓ " : line.kind === "ok" ? "" : "  ";
  return (
    <div className="mono text-[12px] leading-[1.8] pl-3">
      <span className={colorClass}>
        {prefix}
        {line.text}
      </span>
      {line.detail && <span className="text-[color:var(--color-ink-500)]"> · {line.detail}</span>}
    </div>
  );
}

export default function UseCases() {
  const [active, setActive] = useState(0);
  const c = CASES[active];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
      <ul className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible">
        {CASES.map((x, i) => {
          const isActive = i === active;
          return (
            <li key={x.id} className="shrink-0 lg:shrink">
              <button
                type="button"
                onClick={() => setActive(i)}
                className={`w-full min-w-[220px] lg:min-w-0 text-left panel p-4 transition-all ${
                  isActive
                    ? "ring-1 ring-[color:var(--color-blade-500)]"
                    : "opacity-80 hover:opacity-100"
                }`}
                style={{
                  borderLeft: isActive
                    ? "2px solid var(--color-blade-500)"
                    : "2px solid transparent",
                }}
              >
                <div className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-blade-400)] mb-1">
                  case {String(i + 1).padStart(2, "0")}
                </div>
                <h3
                  className={`text-sm font-medium tracking-tight ${isActive ? "text-[color:var(--color-ink-50)]" : "text-[color:var(--color-ink-200)]"}`}
                >
                  {x.title}
                </h3>
                <p className="mt-1 text-[11px] text-[color:var(--color-ink-400)] leading-[1.5]">
                  {x.persona}
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      <div
        className="panel-steel p-5 sm:p-6"
        style={{ borderLeft: "3px solid var(--color-blade-500)" }}
      >
        <div className="mb-4">
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-500)] mb-1">
            § · use case {String(active + 1).padStart(2, "0")}
          </div>
          <h4 className="text-xl text-[color:var(--color-ink-50)] tracking-tight font-medium">
            {c.title}
          </h4>
          <p className="mt-1 text-sm text-[color:var(--color-ink-300)] max-w-[600px]">{c.ask}</p>
        </div>

        {/* One-liner at the top */}
        <div className="panel p-3 mb-4" style={{ borderLeft: "2px solid var(--color-blade-500)" }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">
              the one command
            </span>
            <CopyBtn text={c.command} compact />
          </div>
          <div className="mono text-[13px] text-[color:var(--color-ink-100)] break-all">
            <span className="text-[color:var(--color-blade-400)]">›</span> {c.command}
          </div>
        </div>

        {/* Chat transcript */}
        <div className="panel p-4">
          <div className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)] mb-3">
            chat transcript
          </div>
          <div className="space-y-0">
            {c.turns.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: TurnLine has no id; turns are static case-study transcripts.
              <Turn key={i} line={t} />
            ))}
          </div>
        </div>

        {/* Outcome */}
        <div className="mt-4 flex items-start gap-2">
          <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-blade-400)] shrink-0 pt-0.5">
            outcome
          </span>
          <p className="text-[13px] text-[color:var(--color-ink-200)] leading-[1.55]">
            {c.outcome}
          </p>
        </div>
      </div>
    </div>
  );
}
