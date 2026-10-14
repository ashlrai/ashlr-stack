import { useState } from "react";
import CopyBtn from "~/components/primitives/CopyBtn";

/**
 * UseCases — illustrative flows using supported Stack commands and MCP tools.
 * These are examples, not recorded customer sessions or evidence that a
 * provider accepted a request. Results depend on authentication and setup.
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
    title: "Compose a new SaaS project",
    persona: "solo founder, new repo",
    command:
      "stack init --noInteractive && stack add supabase && stack add posthog && stack add sentry && stack add resend",
    ask: "Start a project with Supabase, PostHog, Sentry, and Resend. What needs my authorization?",
    outcome:
      "If each provider accepts the setup, Stack records service slots in `.stack.toml`, stores credentials in Phantom, and adds available MCP entries to `.mcp.json`. Run `stack env export --example` for empty-key documentation; configure and verify the app separately.",
    turns: [
      {
        kind: "user",
        text: "Start a project with Supabase for auth and data, PostHog for analytics, Sentry for errors, and Resend for email.",
      },
      {
        kind: "assistant",
        text: "I'll initialize a blank Stack config, then add one service at a time. Each service may need your existing account, OAuth approval, or API key.",
      },
      { kind: "tool", text: "stack_init", detail: "blank config; no template" },
      { kind: "work", text: "initialize .stack.toml and .stack.local.toml" },
      { kind: "tool", text: "stack_add", detail: "service=supabase" },
      {
        kind: "work",
        text: "Supabase",
        detail: "authorize OAuth or provide a PAT; create a project if approved",
      },
      { kind: "tool", text: "stack_add", detail: "service=posthog" },
      {
        kind: "work",
        text: "PostHog",
        detail: "provide an API key; verify access to projects",
      },
      { kind: "tool", text: "stack_add", detail: "service=sentry" },
      {
        kind: "work",
        text: "Sentry",
        detail: "provide a PAT and select an existing project",
      },
      { kind: "tool", text: "stack_add", detail: "service=resend" },
      {
        kind: "work",
        text: "Resend",
        detail: "provide an API key; verify key access, then check domain setup separately",
      },
      { kind: "ok", text: "Expected: review each provider result before using the app" },
      {
        kind: "assistant",
        text: "After successful setup, inspect the saved config and MCP entries. Use `stack env export --example` for empty keys; `stack exec -- bun dev` forwards app startup to `phantom exec`.",
      },
    ],
  },
  {
    id: "add-analytics",
    title: "Add analytics to an existing repo",
    persona: "small team, existing app",
    command: "stack add posthog",
    ask: "Add PostHog without changing my existing Supabase environment file.",
    outcome:
      "After a successful key check, Stack can store the PostHog key in Phantom, record its slot in `.stack.toml`, and merge its MCP config entry. It does not patch `.env.local`; `stack exec -- bun dev` forwards to `phantom exec`. Integrate the SDK and verify the app receives what it needs.",
    turns: [
      {
        kind: "user",
        text: "Add PostHog, but leave my existing Supabase .env.local alone.",
      },
      {
        kind: "assistant",
        text: "I'll add the PostHog service. Stack does not rewrite your .env.local; review the resulting config and wire the app SDK separately.",
      },
      { kind: "tool", text: "stack_add", detail: "service=posthog" },
      { kind: "work", text: "request an existing PostHog API key" },
      {
        kind: "work",
        text: "check key against the PostHog projects API",
        detail: "setup continues only if authorization succeeds",
      },
      { kind: "work", text: "store POSTHOG_PERSONAL_API_KEY in Phantom" },
      {
        kind: "work",
        text: "record the service in .stack.toml",
        detail: "existing .env.local stays outside this step",
      },
      {
        kind: "work",
        text: "merge PostHog MCP config entry when available",
        detail: "connection requires separate client verification",
      },
      { kind: "ok", text: "Expected: inspect the saved slot and config" },
      {
        kind: "assistant",
        text: "Next, integrate the PostHog SDK in your app and test an event. `stack exec -- bun dev` forwards the command to `phantom exec`; verify the app's required credentials separately.",
      },
    ],
  },
  {
    id: "rotate-key",
    title: "Respond to a suspected Sentry token leak",
    persona: "on-call, credential review",
    command: "stack doctor",
    ask: "A Sentry auth token appeared in a CI log. Check Stack, then contain and replace the credential.",
    outcome:
      "`stack doctor` checks the declared stack. Revoke the exposed token in Sentry, create a replacement with the required scopes, update the owned Phantom slot, and verify each consumer separately. A health check does not rotate a provider token or prove consumers refreshed.",
    turns: [
      {
        kind: "user",
        text: "A Sentry auth token appeared in a CI log. Can Stack confirm the current state?",
      },
      {
        kind: "assistant",
        text: "I'll run the Stack health check. Token revocation and replacement need separate action in Sentry and Phantom, followed by consumer checks.",
      },
      { kind: "tool", text: "stack_doctor" },
      {
        kind: "work",
        text: "check declared services and local configuration",
        detail: "health output depends on this project and provider access",
      },
      { kind: "work", text: "review the exposed token's scope and logs" },
      { kind: "work", text: "revoke the exposed token in Sentry" },
      {
        kind: "work",
        text: "create a scoped replacement and update the owned Phantom slot",
        detail: "separate provider and vault actions",
      },
      {
        kind: "work",
        text: "restart or refresh affected consumers as needed",
        detail: "CI, app, and MCP clients require independent checks",
      },
      { kind: "ok", text: "Next: verify provider revocation and each consumer" },
      {
        kind: "assistant",
        text: "The check alone cannot certify rotation. Confirm the old token fails at Sentry and each consumer uses the replacement before closing the incident.",
      },
    ],
  },
  {
    id: "compare-providers",
    title: '"Which database should I use?" — explore the catalog',
    persona: "new project, researching",
    command: "stack providers",
    ask: "I need a serverless Postgres. Show the Stack catalog and help me compare supported choices.",
    outcome:
      "`stack providers` lists the catalog; the `stack_providers` MCP tool exposes the same list without a category parameter. Filter the returned database entries for a comparison, then confirm current provider details before adding one.",
    turns: [
      {
        kind: "user",
        text: "I need serverless Postgres for a side project. Which Stack database options should I compare?",
      },
      {
        kind: "assistant",
        text: "I'll read the Stack provider catalog and compare the database entries. The catalog is guidance, not proof of an active provider account.",
      },
      { kind: "tool", text: "stack_providers" },
      {
        kind: "work",
        text: "supabase",
        detail: "OAuth or PAT; project creation through its Management API",
      },
      {
        kind: "work",
        text: "neon",
        detail: "PAT; project creation can return a connection URI",
      },
      { kind: "work", text: "turso", detail: "platform token; libSQL database option" },
      {
        kind: "work",
        text: "convex",
        detail: "catalog entry; inspect its adapter before setup",
      },
      { kind: "work", text: "upstash", detail: "catalog entry; inspect its adapter before setup" },
      { kind: "work", text: "firebase", detail: "catalog entry; inspect its adapter before setup" },
      {
        kind: "assistant",
        text: "If you specifically need Postgres, start with Neon or Supabase. Review account access and current adapter behavior before running `stack add neon` or `stack add supabase`.",
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
    line.kind === "tool" ? "→ " : line.kind === "work" ? "· " : line.kind === "ok" ? "" : "  ";
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

        {/* Copyable example command at the top */}
        <div className="panel p-3 mb-4" style={{ borderLeft: "2px solid var(--color-blade-500)" }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">
              example command
            </span>
            <CopyBtn text={c.command} compact />
          </div>
          <div className="mono text-[13px] text-[color:var(--color-ink-100)] break-all">
            <span className="text-[color:var(--color-blade-400)]">›</span> {c.command}
          </div>
        </div>

        {/* Illustrative interaction */}
        <div className="panel p-4">
          <div className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)] mb-3">
            illustrative interaction
          </div>
          <div className="space-y-0">
            {c.turns.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: TurnLine has no id; turns are static illustrative examples.
              <Turn key={i} line={t} />
            ))}
          </div>
        </div>

        {/* Expected next step */}
        <div className="mt-4 flex items-start gap-2">
          <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-blade-400)] shrink-0 pt-0.5">
            expected next step
          </span>
          <p className="text-[13px] text-[color:var(--color-ink-200)] leading-[1.55]">
            {c.outcome}
          </p>
        </div>
      </div>
    </div>
  );
}
