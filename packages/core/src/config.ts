import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { ConfigNotFoundError } from "./errors.ts";

/**
 * Stack config is split across two files:
 *
 * - `.stack.toml`        (committed) — SHAPE. Services that define this stack,
 *   their canonical secret slot names, and which MCP servers to wire up.
 *   Safe to share via git.
 *
 * - `.stack.local.toml`  (gitignored) — INSTANCE. Per-developer IDs, timestamps,
 *   provider-side resource refs. Auto-added to .gitignore on first write.
 *
 * Callers work with the merged `StackConfig` shape; `readConfig` combines the
 * two files and `writeConfig` splits writes back out. Legacy single-file
 * `.stack.toml` (with instance fields) is read transparently and migrated on
 * the next write.
 */

export const CONFIG_FILENAME = ".stack.toml";
export const LOCAL_FILENAME = ".stack.local.toml";
export const CONFIG_VERSION = "1";

export interface StackRoot {
  version: string;
  project_id: string;
  template?: string;
}

export interface ServiceEntry {
  provider: string;
  /** Provider-side resource id (project_ref, project_id, app name, etc.). INSTANCE. */
  resource_id?: string;
  /** Region. Lives in INSTANCE — can differ per developer if they clone + re-provision. */
  region?: string;
  /** Names of secrets stored in Phantom that belong to this service. SHAPE. */
  secrets: string[];
  /** Name of the MCP server entry in .mcp.json, if any. SHAPE. */
  mcp?: string;
  /** Freeform provider-specific fields. INSTANCE. */
  meta?: Record<string, unknown>;
  /** INSTANCE. */
  created_at: string;
  /** INSTANCE. */
  created_by?: string;
}

export interface EnvironmentEntry {
  name: string;
  default?: boolean;
  overrides?: Record<string, string>;
}

export interface StackConfig {
  stack: StackRoot;
  services: Record<string, ServiceEntry>;
  environments: EnvironmentEntry[];
}

export function emptyConfig(template?: string): StackConfig {
  return {
    stack: {
      version: CONFIG_VERSION,
      project_id: randomProjectId(),
      ...(template ? { template } : {}),
    },
    services: {},
    environments: [{ name: "dev", default: true }],
  };
}

export function randomProjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `stk_${hex}`;
}

export function resolveConfigPath(cwd: string = process.cwd()): string {
  return resolve(join(cwd, CONFIG_FILENAME));
}

export function resolveLocalConfigPath(cwd: string = process.cwd()): string {
  return resolve(join(cwd, LOCAL_FILENAME));
}

export function hasConfig(cwd: string = process.cwd()): boolean {
  return existsSync(resolveConfigPath(cwd));
}

// ---------------------------------------------------------------------------
// Committed shape fragment
// ---------------------------------------------------------------------------

interface ShapeFile {
  stack: { version: string; template?: string };
  services: Record<string, { provider: string; secrets: string[]; mcp?: string }>;
  environments: EnvironmentEntry[];
}

// ---------------------------------------------------------------------------
// Local instance fragment
// ---------------------------------------------------------------------------

interface InstanceFile {
  stack: { project_id: string };
  services: Record<
    string,
    {
      resource_id?: string;
      region?: string;
      meta?: Record<string, unknown>;
      created_at?: string;
      created_by?: string;
    }
  >;
}

// ---------------------------------------------------------------------------
// Read: merge the two files (or migrate a legacy single file)
// ---------------------------------------------------------------------------

export async function readConfig(cwd: string = process.cwd()): Promise<StackConfig> {
  const shapePath = resolveConfigPath(cwd);
  const localPath = resolveLocalConfigPath(cwd);
  if (!existsSync(shapePath)) throw new ConfigNotFoundError(shapePath);

  const rawShape = await readFile(shapePath, "utf-8");
  const shape = parseToml(rawShape) as Record<string, unknown>;

  // Detect legacy single-file config — if the top file carries instance fields
  // (project_id at root, or created_at inside services), treat it as merged.
  const isLegacy =
    (shape.stack as Record<string, unknown> | undefined)?.project_id !== undefined ||
    Object.values((shape.services as Record<string, Record<string, unknown>>) ?? {}).some(
      (s) => s.created_at !== undefined || s.resource_id !== undefined,
    );

  if (isLegacy) return normalizeLegacy(shape);

  const instance = existsSync(localPath)
    ? (parseToml(await readFile(localPath, "utf-8")) as Record<string, unknown>)
    : ({} as Record<string, unknown>);

  return merge(shape as unknown as ShapeFile, instance as unknown as InstanceFile);
}

// ---------------------------------------------------------------------------
// Write: split and route to the two files, auto-gitignore the local one
// ---------------------------------------------------------------------------

export async function writeConfig(config: StackConfig, cwd: string = process.cwd()): Promise<void> {
  const { shape, instance } = split(config);

  const shapeHeader =
    "# Ashlr Stack — committed shape. Defines which services this project uses.\n" +
    "# Safe to share in git; secret *values* live in Phantom, not here.\n";
  await writeFile(
    resolveConfigPath(cwd),
    shapeHeader + stringifyToml(shape as unknown as Record<string, unknown>),
    "utf-8",
  );

  const instanceHeader = "# Ashlr Stack — local instance data. Auto-generated; do not commit.\n";
  await writeFile(
    resolveLocalConfigPath(cwd),
    instanceHeader + stringifyToml(instance as unknown as Record<string, unknown>),
    "utf-8",
  );

  await ensureGitignored(cwd);

  // Best-effort: auto-register the project in the global registry. Failures
  // here (e.g. a read-only home dir) must not break the write itself.
  try {
    const { registerProject } = await import("./registry.ts");
    await registerProject(cwd);
  } catch {
    /* swallow */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function split(config: StackConfig): { shape: ShapeFile; instance: InstanceFile } {
  const shape: ShapeFile = {
    stack: {
      version: config.stack.version,
      ...(config.stack.template ? { template: config.stack.template } : {}),
    },
    services: {},
    environments: config.environments,
  };
  const instance: InstanceFile = {
    stack: { project_id: config.stack.project_id },
    services: {},
  };
  for (const [name, entry] of Object.entries(config.services)) {
    shape.services[name] = {
      provider: entry.provider,
      secrets: entry.secrets,
      ...(entry.mcp ? { mcp: entry.mcp } : {}),
    };
    const inst: InstanceFile["services"][string] = {};
    if (entry.resource_id) inst.resource_id = entry.resource_id;
    if (entry.region) inst.region = entry.region;
    if (entry.meta) inst.meta = entry.meta;
    if (entry.created_at) inst.created_at = entry.created_at;
    if (entry.created_by) inst.created_by = entry.created_by;
    if (Object.keys(inst).length > 0) instance.services[name] = inst;
  }
  return { shape, instance };
}

function merge(shape: ShapeFile, instance: InstanceFile): StackConfig {
  const services: Record<string, ServiceEntry> = {};
  for (const [name, s] of Object.entries(shape.services ?? {})) {
    const i = instance.services?.[name] ?? {};
    services[name] = {
      provider: s.provider,
      secrets: s.secrets,
      ...(s.mcp ? { mcp: s.mcp } : {}),
      ...(i.resource_id ? { resource_id: i.resource_id } : {}),
      ...(i.region ? { region: i.region } : {}),
      ...(i.meta ? { meta: i.meta } : {}),
      created_at: i.created_at ?? "1970-01-01T00:00:00Z",
      ...(i.created_by ? { created_by: i.created_by } : {}),
    };
  }
  return {
    stack: {
      version: shape.stack?.version ?? CONFIG_VERSION,
      project_id: instance.stack?.project_id ?? randomProjectId(),
      ...(shape.stack?.template ? { template: shape.stack.template } : {}),
    },
    services,
    environments: shape.environments?.length
      ? shape.environments
      : [{ name: "dev", default: true }],
  };
}

function normalizeLegacy(raw: Record<string, unknown>): StackConfig {
  const stackField = (raw.stack ?? {}) as Record<string, unknown>;
  const services = (raw.services ?? {}) as Record<string, Record<string, unknown>>;
  const environments = (raw.environments ?? [{ name: "dev", default: true }]) as EnvironmentEntry[];
  const out: StackConfig = {
    stack: {
      version: (stackField.version as string) ?? CONFIG_VERSION,
      project_id: (stackField.project_id as string) ?? randomProjectId(),
      ...(typeof stackField.template === "string" ? { template: stackField.template } : {}),
    },
    services: {},
    environments,
  };
  for (const [name, entry] of Object.entries(services)) {
    out.services[name] = {
      provider: (entry.provider as string) ?? name,
      secrets: (entry.secrets as string[]) ?? [],
      ...(typeof entry.mcp === "string" ? { mcp: entry.mcp } : {}),
      ...(typeof entry.resource_id === "string" ? { resource_id: entry.resource_id } : {}),
      ...(typeof entry.region === "string" ? { region: entry.region } : {}),
      ...(entry.meta ? { meta: entry.meta as Record<string, unknown> } : {}),
      created_at: (entry.created_at as string) ?? new Date().toISOString(),
      ...(typeof entry.created_by === "string" ? { created_by: entry.created_by } : {}),
    };
  }
  return out;
}

async function ensureGitignored(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, ".gitignore");
  const needle = LOCAL_FILENAME;
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, `# Ashlr Stack\n${needle}\n.mcp.json.local\n`, "utf-8");
    return;
  }
  const current = await readFile(gitignorePath, "utf-8");
  if (current.split(/\r?\n/).some((line) => line.trim() === needle)) return;
  const sep = current.endsWith("\n") ? "" : "\n";
  await appendFile(gitignorePath, `${sep}# Ashlr Stack\n${needle}\n`, "utf-8");
}
