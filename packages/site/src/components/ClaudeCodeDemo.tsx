import { motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/**
 * ClaudeCodeDemo — mock Claude Code chat showing `/stack:add supabase` flow.
 *
 * Runs once when scrolled into view. Respects prefers-reduced-motion.
 */

interface Message {
  role: "user" | "assistant" | "tool" | "system";
  kind?: "text" | "tool_use" | "tool_result";
  content: string;
  detail?: string[];
  pending?: boolean;
}

const TIMELINE: Array<{ at: number; msg: Message }> = [
  {
    at: 0,
    msg: { role: "user", content: "/stack:add supabase" },
  },
  {
    at: 350,
    msg: {
      role: "assistant",
      content:
        "I'll add Supabase to this project. Running `stack add supabase` via the MCP server — it'll handle OAuth, create the project, store secrets in Phantom, and wire up .mcp.json for me.",
    },
  },
  {
    at: 1100,
    msg: {
      role: "tool",
      kind: "tool_use",
      content: "stack_add",
      detail: ['provider: "supabase"', 'project: "raven"'],
      pending: true,
    },
  },
  {
    at: 2600,
    msg: {
      role: "tool",
      kind: "tool_result",
      content: "stack_add ✓ 4.2s",
      detail: [
        "✓ OAuth complete (signed in as mason@evero-consulting.com)",
        "✓ Created supabase project raven-prod · us-east-1",
        "✓ Stored 3 secrets in phantom (URL, ANON_KEY, SERVICE_ROLE_KEY)",
        "✓ Patched .env.local · .mcp.json · .stack.toml",
        "✓ Installed @supabase/supabase-js",
      ],
    },
  },
  {
    at: 3200,
    msg: {
      role: "assistant",
      content:
        "Supabase is provisioned and wired. Restart Claude Code to pick up the new MCP server, then you can query the database directly from chat. Want me to scaffold an auth page next?",
    },
  },
];

export default function ClaudeCodeDemo() {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const [visibleCount, setVisibleCount] = useState(0);
  const [toolDone, setToolDone] = useState(false);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setVisibleCount(TIMELINE.length);
      setToolDone(true);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    TIMELINE.forEach((t, i) => {
      timers.push(
        setTimeout(() => setVisibleCount(i + 1), t.at),
      );
    });
    timers.push(setTimeout(() => setToolDone(true), 2450));
    return () => timers.forEach(clearTimeout);
  }, [inView, reduced]);

  return (
    <div
      ref={ref}
      className="panel rounded-2xl overflow-hidden shadow-[0_40px_120px_-40px_rgba(233,107,42,0.22)] relative"
    >
      {/* Chrome */}
      <div className="flex items-center gap-3 px-4 h-10 hairline-bottom">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 flex items-center justify-center gap-1.5 text-xs text-ink-400">
          <span className="mono text-ink-500">◇</span>
          <span className="font-medium">Claude Code</span>
          <span className="text-ink-600 mx-1">·</span>
          <span className="mono text-ink-500">raven</span>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-[10px] text-ink-500 mono">
          <span className="w-1.5 h-1.5 rounded-full bg-magenta-500" />
          stack-mcp
        </div>
      </div>

      {/* Chat body */}
      <div className="px-4 sm:px-6 py-6 min-h-[480px] sm:min-h-[520px] bg-[rgba(0,0,0,0.2)]">
        <div className="space-y-5">
          {TIMELINE.slice(0, visibleCount).map((t, i) => (
            <MessageBubble
              key={i}
              msg={t.msg}
              toolDone={toolDone}
              reduced={!!reduced}
            />
          ))}

          {visibleCount === TIMELINE.length && (
            <motion.div
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex items-center gap-2 text-[12px] text-ink-500 mono"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-magenta-400 animate-pulse" />
              ready
            </motion.div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="hairline-top px-4 sm:px-5 py-3 flex items-center gap-3 bg-[rgba(0,0,0,0.35)]">
        <span className="mono text-sm text-ink-500">›</span>
        <div className="flex-1 text-sm text-ink-500 mono truncate">
          Ask Claude anything…
        </div>
        <kbd className="mono text-[10px] text-ink-500 px-1.5 py-0.5 rounded border border-white/10 bg-white/[0.02]">
          ⌘ K
        </kbd>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  toolDone,
  reduced,
}: {
  msg: Message;
  toolDone: boolean;
  reduced: boolean;
}) {
  const initial = reduced ? false : { opacity: 0, y: 6 };
  const animate = { opacity: 1, y: 0 };

  if (msg.role === "user") {
    return (
      <motion.div
        initial={initial}
        animate={animate}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="flex gap-3"
      >
        <Avatar kind="user" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-ink-500 mb-1">You</div>
          <div className="inline-block max-w-full">
            <code className="mono text-sm text-magenta-300 bg-magenta-500/8 border border-magenta-500/20 rounded-md px-2.5 py-1.5">
              {msg.content}
            </code>
          </div>
        </div>
      </motion.div>
    );
  }

  if (msg.role === "assistant") {
    return (
      <motion.div
        initial={initial}
        animate={animate}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="flex gap-3"
      >
        <Avatar kind="assistant" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-ink-500 mb-1">Claude</div>
          <p className="text-[14px] text-ink-100 leading-[1.65]">{msg.content}</p>
        </div>
      </motion.div>
    );
  }

  // tool_use / tool_result
  const isUse = msg.kind === "tool_use";
  const done = !isUse || toolDone;
  return (
    <motion.div
      initial={initial}
      animate={animate}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex gap-3"
    >
      <Avatar kind="tool" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-ink-500 mb-1 flex items-center gap-1.5">
          <span>MCP · ashlr-stack-mcp</span>
          <span className="text-ink-700">·</span>
          <span className={isUse && !toolDone ? "ansi-yellow" : "ansi-green"}>
            {isUse && !toolDone ? "running" : "complete"}
          </span>
        </div>
        <div className="panel-inner rounded-lg px-3 py-3 mono text-[12px] leading-[1.65]">
          <div className="flex items-center justify-between gap-3">
            <span className="ansi-white">
              {isUse ? `▸ tool_use  ${msg.content}` : `◆ ${msg.content}`}
            </span>
            <span>
              {isUse && !toolDone ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  className="animate-spin"
                  style={{ animationDuration: "1.2s" }}
                  aria-hidden
                >
                  <circle
                    cx="7"
                    cy="7"
                    r="5"
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth="1.5"
                    fill="none"
                  />
                  <path
                    d="M7 2 A5 5 0 0 1 12 7"
                    stroke="#f5883e"
                    strokeWidth="1.75"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                  <path
                    d="M2.5 7.5 L5.5 10.5 L11.5 4"
                    stroke="#4ade80"
                    strokeWidth="1.75"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
          </div>
          {msg.detail && msg.detail.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {msg.detail.map((d, i) => (
                <div
                  key={i}
                  className={
                    done && !isUse ? "ansi-green" : "ansi-dim"
                  }
                >
                  {done && !isUse ? d : `· ${d}`}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Avatar({ kind }: { kind: "user" | "assistant" | "tool" }) {
  if (kind === "user") {
    return (
      <div className="flex-none w-7 h-7 rounded-full bg-ink-800 hairline flex items-center justify-center text-[11px] text-ink-300 mono">
        m
      </div>
    );
  }
  if (kind === "assistant") {
    return (
      <div className="flex-none w-7 h-7 rounded-full bg-[#c2410c] flex items-center justify-center text-white">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="12" cy="12" r="10" fill="#ffffff" opacity="0.0" />
          <path d="M6.5 17 L12 5 L17.5 17 M8.5 14 H15.5" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  return (
    <div
      className="flex-none w-7 h-7 rounded-full flex items-center justify-center"
      style={{
        background:
          "linear-gradient(135deg, rgba(233,107,42,0.16), rgba(233,107,42,0.04))",
        border: "1px solid rgba(233,107,42,0.35)",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3 L21 20 L3 20 Z" fill="#e96b2a" />
      </svg>
    </div>
  );
}
