import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

/**
 * One-command onboarding: detect installed coding agents and register the
 * Phantom gateway (`ashlr mcp`, server name `ashlr-hub`) in each one.
 *
 * Rules: plan by default (nothing is written), backup before every write,
 * never overwrite an entry that differs from the expected one, no network, no
 * vendor CLI, and undo restores byte for byte (refused if the file changed
 * since we wrote it).
 */

export const GATEWAY_SERVER_NAME = "ashlr-hub";
export const GATEWAY_COMMAND = "ashlr";
export const GATEWAY_ARGS = ["mcp"] as const;

export type AgentClient = "claude" | "codex" | "cursor" | "gemini";
export const AGENT_CLIENTS: readonly AgentClient[] = ["claude", "codex", "cursor", "gemini"];

interface ClientSpec {
  client: AgentClient;
  /** Config path relative to the home directory. */
  configRel: string[];
  /** Directory (relative to home) whose presence means the client is installed. */
  detectDirRel: string[];
  /** Binary whose presence on PATH means the client is installed. */
  binary: string;
  format: "json" | "toml";
  /** Expected JSON entry (json clients). */
  entry?: Record<string, unknown>;
}

const SPECS: Record<AgentClient, ClientSpec> = {
  claude: {
    client: "claude",
    configRel: [".claude.json"],
    detectDirRel: [".claude"],
    binary: "claude",
    format: "json",
    entry: { type: "stdio", command: GATEWAY_COMMAND, args: [...GATEWAY_ARGS], env: {} },
  },
  codex: {
    client: "codex",
    configRel: [".codex", "config.toml"],
    detectDirRel: [".codex"],
    binary: "codex",
    format: "toml",
  },
  cursor: {
    client: "cursor",
    configRel: [".cursor", "mcp.json"],
    detectDirRel: [".cursor"],
    binary: "cursor",
    format: "json",
    entry: { command: GATEWAY_COMMAND, args: [...GATEWAY_ARGS] },
  },
  gemini: {
    client: "gemini",
    configRel: [".gemini", "settings.json"],
    detectDirRel: [".gemini"],
    binary: "gemini",
    format: "json",
    entry: { command: GATEWAY_COMMAND, args: [...GATEWAY_ARGS] },
  },
};

export type OnboardState = "not-detected" | "not-wired" | "wired" | "differs" | "error";

export interface OnboardEntryPlan {
  client: AgentClient;
  configPath: string;
  detected: boolean;
  state: OnboardState;
  /** True when `--apply` would write this file. */
  willWrite: boolean;
  error?: string;
}

export interface OnboardOptions {
  /** Home directory to read and write under. Defaults to the real home. */
  home?: string;
  /** PATH value used for binary detection. Defaults to process.env.PATH. */
  pathEnv?: string;
  /** Limit to these clients. Defaults to all four. */
  clients?: readonly AgentClient[];
  /** Also wire clients that are not detected (creates their config). */
  includeUndetected?: boolean;
}

export function configPathFor(client: AgentClient, home: string): string {
  return join(home, ...SPECS[client].configRel);
}

function binaryOnPath(binary: string, pathEnv: string): boolean {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidates =
      process.platform === "win32"
        ? [".exe", ".cmd", ".bat", ""].map((e) => join(dir, binary + e))
        : [join(dir, binary)];
    for (const c of candidates) {
      try {
        if (statSync(c).isFile()) return true;
      } catch {
        /* not here */
      }
    }
  }
  return false;
}

function isDetected(spec: ClientSpec, home: string, pathEnv: string): boolean {
  return existsSync(join(home, ...spec.detectDirRel)) || binaryOnPath(spec.binary, pathEnv);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, val]) => [k, sortKeys(val)]),
    );
  }
  return v;
}

const TOML_BLOCK = `[mcp_servers.${GATEWAY_SERVER_NAME}]\ncommand = "${GATEWAY_COMMAND}"\nargs = [${GATEWAY_ARGS.map((a) => `"${a}"`).join(", ")}]\n`;

function codexSection(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const header = new RegExp(
    `^\\s*\\[mcp_servers\\.(?:"${GATEWAY_SERVER_NAME}"|${GATEWAY_SERVER_NAME})\\]\\s*(?:#.*)?$`,
  );
  const start = lines.findIndex((l) => header.test(l));
  if (start < 0) return undefined;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i] as string)) break;
    body.push(lines[i] as string);
  }
  return body.join("\n");
}

interface Inspection {
  state: Exclude<OnboardState, "not-detected">;
  error?: string;
}

function inspectFile(spec: ClientSpec, path: string): Inspection {
  if (!existsSync(path)) return { state: "not-wired" };
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    return { state: "error", error: (err as Error).message };
  }
  if (spec.format === "toml") {
    const body = codexSection(raw);
    if (body === undefined) return { state: "not-wired" };
    const command = /^\s*command\s*=\s*"([^"]*)"\s*(?:#.*)?$/m.exec(body)?.[1];
    const args = /^\s*args\s*=\s*\[([^\]]*)\]\s*(?:#.*)?$/m.exec(body)?.[1]?.trim();
    return command === GATEWAY_COMMAND && args === GATEWAY_ARGS.map((a) => `"${a}"`).join(", ")
      ? { state: "wired" }
      : { state: "differs" };
  }
  if (raw.trim() === "") return { state: "not-wired" };
  try {
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { state: "error", error: "config is not a JSON object" };
    }
    const servers = parsed.mcpServers;
    if (servers !== undefined && (servers === null || typeof servers !== "object")) {
      return { state: "error", error: "mcpServers is not an object" };
    }
    const entry = servers?.[GATEWAY_SERVER_NAME];
    if (entry === undefined) return { state: "not-wired" };
    return sameJson(entry, spec.entry) ? { state: "wired" } : { state: "differs" };
  } catch (err) {
    return { state: "error", error: `could not parse ${path}: ${(err as Error).message}` };
  }
}

export function planOnboarding(opts: OnboardOptions = {}): OnboardEntryPlan[] {
  const home = opts.home ?? homedir();
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const clients = opts.clients ?? AGENT_CLIENTS;
  return clients.map((client) => {
    const spec = SPECS[client];
    const configPath = configPathFor(client, home);
    const detected = isDetected(spec, home, pathEnv);
    const inspected = inspectFile(spec, configPath);
    if (!detected && !opts.includeUndetected && inspected.state === "not-wired") {
      return { client, configPath, detected, state: "not-detected", willWrite: false };
    }
    return {
      client,
      configPath,
      detected,
      state: inspected.state,
      willWrite: inspected.state === "not-wired",
      ...(inspected.error ? { error: inspected.error } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// apply and undo
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  client: AgentClient;
  configPath: string;
  /** Backup copy of the original file, or null when the file did not exist. */
  backupPath: string | null;
  /** SHA-256 of the file as we wrote it. */
  postHash: string;
}
export interface OnboardManifest {
  schema: "ashlr.stack.onboard/v1";
  createdAt: string;
  entries: ManifestEntry[];
}

export function manifestPath(home: string): string {
  return join(home, ".ashlr-stack", "onboard-manifest.json");
}

const sha = (buf: Buffer | string): string => createHash("sha256").update(buf).digest("hex");

async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.stack-tmp-${process.pid}`;
  await writeFile(tmp, data, "utf-8");
  await rename(tmp, path);
}

function renderJson(spec: ClientSpec, existing: string | undefined): string {
  const base =
    existing && existing.trim() !== "" ? (JSON.parse(existing) as Record<string, unknown>) : {};
  const servers = { ...((base.mcpServers as Record<string, unknown> | undefined) ?? {}) };
  servers[GATEWAY_SERVER_NAME] = spec.entry;
  return `${JSON.stringify({ ...base, mcpServers: servers }, null, 2)}\n`;
}

function renderToml(existing: string | undefined): string {
  if (!existing || existing.trim() === "") return TOML_BLOCK;
  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${sep}${TOML_BLOCK}`;
}

export interface ApplyResult {
  written: ManifestEntry[];
  skipped: OnboardEntryPlan[];
  /** Plan re-run after writing, as proof. */
  verified: OnboardEntryPlan[];
  manifestPath: string | null;
}

export async function applyOnboarding(opts: OnboardOptions = {}): Promise<ApplyResult> {
  const home = opts.home ?? homedir();
  const plan = planOnboarding(opts);
  const written: ManifestEntry[] = [];
  const skipped: OnboardEntryPlan[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const item of plan) {
    if (!item.willWrite) {
      skipped.push(item);
      continue;
    }
    const spec = SPECS[item.client];
    const exists = existsSync(item.configPath);
    const existing = exists ? await readFile(item.configPath, "utf-8") : undefined;
    const next = spec.format === "toml" ? renderToml(existing) : renderJson(spec, existing);
    let backupPath: string | null = null;
    if (exists) {
      backupPath = `${item.configPath}.stack-bak-${stamp}`;
      await copyFile(item.configPath, backupPath);
    }
    await atomicWrite(item.configPath, next);
    written.push({
      client: item.client,
      configPath: item.configPath,
      backupPath,
      postHash: sha(next),
    });
  }
  let mPath: string | null = null;
  if (written.length > 0) {
    mPath = manifestPath(home);
    const manifest: OnboardManifest = {
      schema: "ashlr.stack.onboard/v1",
      createdAt: new Date().toISOString(),
      entries: written,
    };
    await atomicWrite(mPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { written, skipped, verified: planOnboarding(opts), manifestPath: mPath };
}

export interface UndoResult {
  restored: ManifestEntry[];
  refused: Array<{ entry: ManifestEntry; reason: string }>;
}

export async function undoOnboarding(opts: { home?: string } = {}): Promise<UndoResult> {
  const home = opts.home ?? homedir();
  const mPath = manifestPath(home);
  if (!existsSync(mPath)) throw new Error("No onboarding manifest found; nothing to undo.");
  const manifest = JSON.parse(await readFile(mPath, "utf-8")) as OnboardManifest;
  const restored: ManifestEntry[] = [];
  const refused: UndoResult["refused"] = [];
  for (const entry of manifest.entries) {
    if (!existsSync(entry.configPath)) {
      refused.push({ entry, reason: "config file no longer exists" });
      continue;
    }
    if (sha(await readFile(entry.configPath)) !== entry.postHash) {
      refused.push({ entry, reason: "file changed since onboarding wrote it" });
      continue;
    }
    if (entry.backupPath === null) {
      await rm(entry.configPath);
    } else if (!existsSync(entry.backupPath)) {
      refused.push({ entry, reason: "backup file is missing" });
      continue;
    } else {
      await copyFile(entry.backupPath, entry.configPath);
    }
    restored.push(entry);
  }
  if (refused.length === 0) await rm(mPath);
  else {
    const remaining: OnboardManifest = { ...manifest, entries: refused.map((r) => r.entry) };
    await atomicWrite(mPath, `${JSON.stringify(remaining, null, 2)}\n`);
  }
  return { restored, refused };
}
