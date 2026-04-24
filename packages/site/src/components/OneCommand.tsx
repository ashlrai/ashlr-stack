import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

type Tab = "without" | "with";

type StepLine = { t: "cmd" | "note" | "ok" | "warn" | "bare" | "blank"; text: string };

const WITHOUT: { title: string; lines: StepLine[] }[] = [
  {
    title: "1. Create Supabase project (browser)",
    lines: [
      { t: "note", text: "→ open supabase.com/dashboard → new project" },
      { t: "note", text: "→ pick region, wait ~60s for provision" },
      { t: "note", text: "→ settings › api › copy URL + anon + service_role" },
    ],
  },
  {
    title: "2. Paste keys into .env.local",
    lines: [
      { t: "cmd", text: "$ vim .env.local" },
      { t: "bare", text: "NEXT_PUBLIC_SUPABASE_URL=https://abc123.supabase.co" },
      { t: "bare", text: "NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci…" },
      { t: "bare", text: "SUPABASE_SERVICE_ROLE_KEY=eyJhbGci…" },
    ],
  },
  {
    title: "3. Install client",
    lines: [{ t: "cmd", text: "$ bun add @supabase/supabase-js" }],
  },
  {
    title: "4. Wire up MCP server by hand",
    lines: [
      { t: "cmd", text: "$ vim .mcp.json" },
      { t: "bare", text: '{ "mcpServers": { "supabase": {' },
      { t: "bare", text: '   "command": "npx",' },
      { t: "bare", text: '   "args": ["-y", "@supabase/mcp-server-supabase"],' },
      { t: "bare", text: '   "env": { "SUPABASE_ACCESS_TOKEN": "???" }' },
      { t: "bare", text: "} } }" },
    ],
  },
  {
    title: "5. Generate personal access token (browser)",
    lines: [
      { t: "note", text: "→ supabase.com/dashboard/account/tokens" },
      { t: "note", text: "→ copy, paste into .mcp.json, swear a little" },
    ],
  },
  {
    title: "6. Lint your .env out of git history (just in case)",
    lines: [
      { t: "warn", text: "⚠ you've done this part wrong before" },
      { t: "cmd", text: "$ git log -p | grep SERVICE_ROLE…  # please no" },
    ],
  },
  {
    title: "7. Restart Claude Code, pray MCP attaches",
    lines: [{ t: "note", text: "→ quit. relaunch. squint at logs." }],
  },
  {
    title: "8. Realize you forgot to add Sentry, Resend, PostHog…",
    lines: [{ t: "warn", text: "repeat steps 1–7, seven more times" }],
  },
];

const WITH_LINES: StepLine[] = [
  { t: "cmd", text: "$ stack add supabase" },
  { t: "blank", text: "" },
  { t: "bare", text: "▲ stack  adding supabase" },
  { t: "bare", text: "✓ OAuth (browser)               signed in as mason" },
  { t: "bare", text: "✓ new project raven-prod        us-east-1" },
  { t: "bare", text: "✓ secrets → phantom vault       URL · ANON · SERVICE_ROLE" },
  { t: "bare", text: "✓ patched .env.local · .mcp.json · .stack.toml" },
  { t: "bare", text: "✓ installed @supabase/supabase-js" },
  { t: "blank", text: "" },
  { t: "ok", text: "✓ supabase ready · 4.2s" },
  { t: "note", text: "  next: stack exec -- bun dev" },
];

export default function OneCommand() {
  const [tab, setTab] = useState<Tab>("without");
  const reduced = useReducedMotion();

  return (
    <div className="relative">
      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Before and after comparison"
        className="inline-flex p-1 rounded-full panel hairline mb-6"
      >
        <TabButton
          active={tab === "without"}
          onClick={() => setTab("without")}
          label="Without Stack"
          sublabel="8 steps · ~45 min"
          id="tab-without"
          panelId="panel-without"
        />
        <TabButton
          active={tab === "with"}
          onClick={() => setTab("with")}
          label="With Stack"
          sublabel="1 command · ~4 sec"
          id="tab-with"
          panelId="panel-with"
          accent
        />
      </div>

      <div className="relative">
        <AnimatePresence mode="wait" initial={false}>
          {tab === "without" ? (
            <motion.div
              key="without"
              id="panel-without"
              role="tabpanel"
              aria-labelledby="tab-without"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="grid gap-3 sm:grid-cols-2"
            >
              {WITHOUT.map((step, i) => (
                <div
                  key={step.title}
                  className="panel rounded-xl p-4 sm:p-5 relative overflow-hidden"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      aria-hidden
                      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/5 text-[10px] font-semibold text-ink-300 mono"
                    >
                      {i + 1}
                    </span>
                    <h4 className="text-[13px] font-medium text-ink-100">{step.title}</h4>
                  </div>
                  <div className="mono text-[12px] leading-[1.65] space-y-0.5">
                    {step.lines.map((l, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: StepLine has no stable id; lines are static and never reorder.
                      <AnsiLine key={i} line={l} />
                    ))}
                  </div>
                </div>
              ))}
              <div className="sm:col-span-2 mt-2 flex items-center gap-3 text-xs text-ink-400">
                <span className="inline-flex items-center gap-1.5">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                    role="img"
                    aria-label="Clock"
                  >
                    <title>Clock</title>
                    <circle
                      cx="6"
                      cy="6"
                      r="5"
                      stroke="currentColor"
                      fill="none"
                      strokeWidth="1.1"
                    />
                    <path
                      d="M6 3v3.2l2 1.3"
                      stroke="currentColor"
                      strokeWidth="1.1"
                      fill="none"
                      strokeLinecap="round"
                    />
                  </svg>
                  45 minutes
                </span>
                <span className="text-ink-600">·</span>
                <span>Context-switches: 12</span>
                <span className="text-ink-600">·</span>
                <span>Secrets pasted into plain text: at least 3</span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="with"
              id="panel-with"
              role="tabpanel"
              aria-labelledby="tab-with"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="panel rounded-2xl p-5 sm:p-7 relative overflow-hidden">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-px rounded-2xl"
                  style={{
                    background:
                      "radial-gradient(600px 200px at 50% -10%, rgba(233,107,42,0.12), transparent 60%)",
                  }}
                />
                <div className="relative mono text-[13px] leading-[1.75] space-y-0">
                  {WITH_LINES.map((l, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: WITH_LINES is a static demo transcript; lines never reorder.
                    <AnsiLine key={i} line={l} big />
                  ))}
                </div>
              </div>

              <div className="mt-4 grid sm:grid-cols-3 gap-3">
                <Stat label="Duration" value="4.2s" sub="vs 45 min" />
                <Stat label="Context switches" value="0" sub="vs 12" />
                <Stat label="Secrets in plaintext" value="0" sub="vs ≥ 3" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  sublabel,
  id,
  panelId,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sublabel: string;
  id: string;
  panelId: string;
  accent?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`relative px-4 py-2 rounded-full text-sm font-medium transition-colors ${
        active ? "text-white" : "text-ink-400 hover:text-ink-200"
      }`}
    >
      {active && (
        <motion.span
          layoutId="one-command-pill"
          className={`absolute inset-0 rounded-full ${
            accent
              ? "bg-[color:var(--color-blade-500)] shadow-[0_8px_24px_-8px_rgba(233,107,42,0.6)]"
              : "bg-white/8 ring-1 ring-white/10"
          }`}
          transition={{ type: "spring", bounce: 0.18, duration: 0.5 }}
        />
      )}
      <span className="relative flex items-baseline gap-2">
        <span>{label}</span>
        <span
          className={`text-[10px] mono ${
            active ? (accent ? "text-white/80" : "text-ink-300") : "text-ink-500"
          }`}
        >
          {sublabel}
        </span>
      </span>
    </button>
  );
}

function AnsiLine({ line, big = false }: { line: StepLine; big?: boolean }) {
  const base = big ? "" : "";
  if (line.t === "blank") return <div className="h-[1.75em]" aria-hidden />;
  if (line.t === "cmd") {
    return (
      <div className={base}>
        <span className="ansi-magenta select-none">$ </span>
        <span className="ansi-white">{line.text.replace(/^\$\s*/, "")}</span>
      </div>
    );
  }
  if (line.t === "ok") {
    return <div className={`ansi-green ${base}`}>{line.text}</div>;
  }
  if (line.t === "warn") {
    return <div className={`ansi-yellow ${base}`}>{line.text}</div>;
  }
  if (line.t === "note") {
    return <div className={`ansi-dim ${base}`}>{line.text}</div>;
  }
  return <div className={`ansi-white ${base}`}>{line.text}</div>;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="panel rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-[0.12em] text-ink-500 font-medium">
        {label}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-white tabular-nums">{value}</span>
        <span className="text-xs text-ink-400">{sub}</span>
      </div>
    </div>
  );
}
