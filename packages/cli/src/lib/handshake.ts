/**
 * Ashlr companion handshake v1 (`stack --ashlr-handshake`). One JSON object
 * that tells `phm companions` / `phm doctor` (or any agent) what this CLI is,
 * what it can do, whether it is healthy, and which files it may edit, so they
 * stop guessing from `--help`. Contract: docs/ashlr-handshake.md.
 *
 * Cheap and local: no network, no vault, no secret values, no project
 * parsing beyond checking whether `.stack.toml` exists.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

export type HealthStatus = "ok" | "degraded" | "unknown";

export interface HandshakeCheck {
  id: string;
  status: "ok" | "missing" | "absent";
}

export interface Handshake {
  kind: "ashlr.handshake";
  schema_version: 1;
  name: string;
  command: string;
  version: string;
  protocols: Record<string, number>;
  capabilities: string[];
  health: { status: HealthStatus; checks: HandshakeCheck[] };
  edits: string[];
  receipts: string[];
}

export interface HandshakeDeps {
  /** Path of `name` on PATH, or null. */
  which: (name: string) => string | null;
  cwd: string;
  exists: (path: string) => boolean;
}

function defaultWhich(name: string): string | null {
  const bun = (globalThis as { Bun?: { which?: (n: string) => string | null } }).Bun;
  return bun?.which ? bun.which(name) : null;
}

export function buildHandshake(version: string, deps: Partial<HandshakeDeps> = {}): Handshake {
  const which = deps.which ?? defaultWhich;
  const cwd = deps.cwd ?? process.cwd();
  const exists = deps.exists ?? existsSync;
  const phantom = which("phantom") !== null;
  const checks: HandshakeCheck[] = [
    // Stack stores provisioned credentials in Phantom Secrets.
    { id: "phantom-on-path", status: phantom ? "ok" : "missing" },
    // Informational: a directory without a stack is not unhealthy.
    { id: "stack-config", status: exists(join(cwd, ".stack.toml")) ? "ok" : "absent" },
  ];
  return {
    kind: "ashlr.handshake",
    schema_version: 1,
    name: "ashlr-stack",
    command: "stack",
    version,
    protocols: { "ashlr.handshake": 1, "phantom.agent.preflight": 1 },
    capabilities: [
      "provision-services",
      "store-credentials-in-phantom",
      "mcp-server",
      "agent-onboard",
      "agent-preflight",
      "doctor-json",
    ],
    health: { status: phantom ? "ok" : "degraded", checks },
    edits: [
      ".stack.toml",
      ".stack.local.toml",
      ".mcp.json",
      ".cursor/mcp.json",
      "~/.claude.json",
      "~/.codex/config.toml",
      "~/.cursor/mcp.json",
      "~/.gemini/settings.json",
    ],
    receipts: [],
  };
}
