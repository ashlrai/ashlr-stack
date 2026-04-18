import { useState } from "react";
import CopyBtn from "~/components/primitives/CopyBtn";

/**
 * McpClientsGrid — five MCP-capable agent clients. Click a card to inline-
 * expand the real config snippet Stack writes (path + contents) for that
 * client. Hand-authored SVG marks kept from the previous static version.
 */

interface Client {
  name: string;
  url: string;
  color: string;
  meta: string;
  /** Config file path Stack patches. */
  configPath: string;
  /** JSON or text Stack appends to that file. */
  configSnippet: string;
  /** How to kick the client into re-reading config after install. */
  reloadTip: string;
}

const CLIENTS: Client[] = [
  {
    name: "Claude Code",
    url: "https://claude.com/claude-code",
    color: "#D97757",
    meta: "Anthropic · MCP native",
    configPath: ".mcp.json  (project root) · or ~/.claude/settings.json (global)",
    configSnippet: `{
  "mcpServers": {
    "stack": {
      "command": "stack",
      "args": ["mcp", "serve"],
      "env": { "STACK_PHANTOM_BIN": "phantom" }
    }
  }
}`,
    reloadTip: "/mcp reconnect  — or restart the CLI",
  },
  {
    name: "Cursor",
    url: "https://cursor.com",
    color: "#e96b2a",
    meta: "IDE · MCP",
    configPath: "~/.cursor/mcp.json",
    configSnippet: `{
  "mcpServers": {
    "stack": {
      "command": "stack",
      "args": ["mcp", "serve"]
    }
  }
}`,
    reloadTip: "Cmd-Shift-P → 'MCP: Reload servers'",
  },
  {
    name: "Windsurf",
    url: "https://codeium.com/windsurf",
    color: "#2BC4B6",
    meta: "Codeium · MCP",
    configPath: "~/.codeium/windsurf-next/mcp_config.json",
    configSnippet: `{
  "mcpServers": {
    "stack": {
      "command": "stack",
      "args": ["mcp", "serve"],
      "transport": "stdio"
    }
  }
}`,
    reloadTip: "Cascade panel → Plugins → ↻ Refresh",
  },
  {
    name: "OpenAI Codex",
    url: "https://openai.com/codex",
    color: "#10A37F",
    meta: "OpenAI · tool use",
    configPath: "~/.codex/config.json",
    configSnippet: `{
  "tools": [
    {
      "type": "mcp",
      "name": "stack",
      "command": "stack",
      "args": ["mcp", "serve"]
    }
  ]
}`,
    reloadTip: "codex config reload",
  },
  {
    name: "ashlrcode",
    url: "https://github.com/ashlrai/ashlrcode",
    color: "#f5883e",
    meta: "Ashlr · multi-model",
    configPath: ".ashlrcode/mcp.json  (per-project)",
    configSnippet: `{
  "servers": {
    "stack": {
      "command": "stack",
      "args": ["mcp", "serve"],
      "scope": "project"
    }
  }
}`,
    reloadTip: "/reload mcp — in-chat slash command",
  },
];

function Mark({ name }: { name: string }) {
  const common = { width: 32, height: 32, viewBox: "0 0 40 40", "aria-hidden": true } as const;
  if (name === "Claude Code") {
    return (
      <svg {...common} fill="currentColor">
        <g>
          <ellipse cx="20" cy="20" rx="3" ry="14" />
          <ellipse cx="20" cy="20" rx="3" ry="14" transform="rotate(45 20 20)" />
          <ellipse cx="20" cy="20" rx="3" ry="14" transform="rotate(90 20 20)" />
          <ellipse cx="20" cy="20" rx="3" ry="14" transform="rotate(135 20 20)" />
        </g>
      </svg>
    );
  }
  if (name === "Cursor") {
    return (
      <svg {...common} fill="currentColor">
        <path d="M8 6 L32 20 L21 22 L16 33 Z" />
      </svg>
    );
  }
  if (name === "Windsurf") {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <path d="M4 26 Q12 16 20 22 T36 18" />
        <path d="M4 20 Q12 10 20 16 T36 12" opacity="0.7" />
        <path d="M4 32 Q12 22 20 28 T36 24" opacity="0.4" />
      </svg>
    );
  }
  if (name === "OpenAI Codex") {
    return (
      <svg {...common} fill="currentColor">
        <g transform="translate(20 20)">
          <ellipse rx="2.4" ry="11" />
          <ellipse rx="2.4" ry="11" transform="rotate(60)" />
          <ellipse rx="2.4" ry="11" transform="rotate(120)" />
        </g>
      </svg>
    );
  }
  if (name === "ashlrcode") {
    return (
      <svg {...common} fill="currentColor">
        <path d="M20 7 L33 30 L7 30 Z" />
        <path d="M20 14 L27 26 L13 26 Z" fill="var(--color-ink-950, #050506)" />
      </svg>
    );
  }
  return null;
}

export default function McpClientsGrid() {
  const [active, setActive] = useState<string | null>(null);
  const activeClient = CLIENTS.find((c) => c.name === active) ?? null;

  return (
    <div>
      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {CLIENTS.map((c) => {
          const isActive = c.name === active;
          return (
            <li key={c.name}>
              <button
                type="button"
                onClick={() => setActive(isActive ? null : c.name)}
                className={`mcp-client group relative w-full text-left panel p-5 h-[160px] overflow-hidden transition-all ${
                  isActive ? "ring-1 ring-[color:var(--color-blade-500)]" : ""
                }`}
                style={{ ["--accent" as string]: c.color }}
                aria-pressed={isActive}
                aria-label={`${c.name} — ${c.meta}`}
              >
                <span
                  aria-hidden
                  className="mcp-glow pointer-events-none absolute inset-0 opacity-0 transition-opacity"
                  style={{
                    background: "radial-gradient(200px 80px at 50% 130%, var(--accent), transparent 60%)",
                    mixBlendMode: "screen",
                  }}
                />
                <div className="relative flex flex-col h-full justify-between">
                  <div className="mcp-mark w-10 h-10 flex items-center justify-center text-[color:var(--color-ink-100)] group-hover:text-[color:var(--accent)] transition-colors">
                    <Mark name={c.name} />
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold text-white tracking-tight">{c.name}</div>
                    <div className="text-[11px] mono text-[color:var(--color-ink-400)] mt-0.5">{c.meta}</div>
                    <div className={`text-[10px] mono tracking-[0.1em] uppercase mt-2 transition-colors ${
                      isActive ? "text-[color:var(--color-blade-400)]" : "text-[color:var(--color-ink-500)] group-hover:text-[color:var(--color-blade-400)]"
                    }`}>
                      {isActive ? "close ↑" : "show config →"}
                    </div>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {activeClient && (
        <div
          className="panel-steel mt-4 p-5 sm:p-6"
          style={{ borderLeft: `3px solid ${activeClient.color}` }}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--color-ink-500)] mb-1">
                § · config for {activeClient.name}
              </div>
              <h4 className="text-xl text-[color:var(--color-ink-50)] tracking-tight font-medium">
                {activeClient.name}
              </h4>
              <p className="mt-1 mono text-[12px] text-[color:var(--color-ink-400)] break-all">
                {activeClient.configPath}
              </p>
            </div>
            <a
              href={activeClient.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-[10px] tracking-[0.12em] uppercase text-[color:var(--color-ink-300)] hover:text-[color:var(--color-blade-400)]"
            >
              upstream ↗
            </a>
          </div>

          <div className="panel p-3" style={{ borderLeft: "2px solid var(--color-blade-500)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-ink-500)]">
                what stack writes
              </span>
              <CopyBtn text={activeClient.configSnippet} compact />
            </div>
            <pre className="mono text-[12px] text-[color:var(--color-ink-200)] leading-[1.6] overflow-x-auto">
              {activeClient.configSnippet}
            </pre>
          </div>

          <div className="mt-3 flex items-start gap-2">
            <span className="mono text-[10px] tracking-[0.14em] uppercase text-[color:var(--color-blade-400)] shrink-0 pt-1">
              reload
            </span>
            <span className="text-[13px] text-[color:var(--color-ink-200)] mono">
              {activeClient.reloadTip}
            </span>
          </div>
        </div>
      )}

      <style>{`
        .mcp-client { transition: border-color 240ms ease, transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1); }
        .mcp-client:hover { border-color: color-mix(in oklab, var(--accent) 35%, transparent); transform: translateY(-2px); }
        .mcp-client:hover .mcp-glow { opacity: 0.55 !important; }
        .mcp-client:hover .mcp-mark { transform: scale(1.08); }
        .mcp-mark { transition: transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1), color 180ms ease; }
      `}</style>
    </div>
  );
}
