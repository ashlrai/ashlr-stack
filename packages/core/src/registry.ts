import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { CONFIG_FILENAME, hasConfig, readConfig, resolveConfigPath } from "./config.ts";

/**
 * Machine-global registry of every Stack-enabled project this user has
 * touched. Lives at ~/.stack/projects.json and is the backbone of cross-project
 * commands like `stack projects list` and `stack doctor --all`.
 *
 * Auto-maintained: every write of .stack.toml (via writeConfig) calls
 * `registerProject(cwd)`. Paths that no longer exist get pruned on next read.
 */

export interface RegistryEntry {
  /** Absolute canonical path to the project root (where .stack.toml lives). */
  path: string;
  /** Derived from the directory basename. */
  name: string;
  /** project_id from .stack.local.toml. */
  project_id: string;
  /** Template (if any) the project was seeded from. */
  template?: string;
  /** Service names in this project. */
  services: string[];
  /** Last time Stack touched this entry, ISO timestamp. */
  last_seen: string;
}

interface RegistryFile {
  version: "1";
  projects: RegistryEntry[];
}

export function registryPath(): string {
  const base = process.env.STACK_REGISTRY_DIR ?? resolve(homedir(), ".stack");
  return resolve(base, "projects.json");
}

async function readRegistryRaw(): Promise<RegistryFile> {
  const path = registryPath();
  if (!existsSync(path)) return { version: "1", projects: [] };
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RegistryFile>;
    return { version: "1", projects: parsed.projects ?? [] };
  } catch {
    return { version: "1", projects: [] };
  }
}

async function writeRegistryRaw(file: RegistryFile): Promise<void> {
  const path = registryPath();
  const dir = resolve(path, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

export async function registerProject(cwd: string): Promise<RegistryEntry | undefined> {
  const path = resolve(cwd);
  if (!hasConfig(path)) return undefined;
  const config = await readConfig(path);
  const entry: RegistryEntry = {
    path,
    name: basename(path),
    project_id: config.stack.project_id,
    template: config.stack.template,
    services: Object.keys(config.services),
    last_seen: new Date().toISOString(),
  };
  const file = await readRegistryRaw();
  const filtered = file.projects.filter((p) => p.path !== path);
  filtered.push(entry);
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  await writeRegistryRaw({ version: "1", projects: filtered });
  return entry;
}

export async function unregisterProject(path: string): Promise<void> {
  const resolved = resolve(path);
  const file = await readRegistryRaw();
  await writeRegistryRaw({
    version: "1",
    projects: file.projects.filter((p) => p.path !== resolved),
  });
}

export async function listProjects(opts: { prune?: boolean } = {}): Promise<RegistryEntry[]> {
  const file = await readRegistryRaw();
  if (opts.prune === false) return file.projects;
  // Drop entries whose .stack.toml has been deleted.
  const alive = file.projects.filter((p) => existsSync(resolveConfigPath(p.path)));
  if (alive.length !== file.projects.length) {
    await writeRegistryRaw({ version: "1", projects: alive });
  }
  return alive;
}

export async function findProjectByName(name: string): Promise<RegistryEntry | undefined> {
  const projects = await listProjects();
  const exact = projects.find((p) => p.name === name);
  if (exact) return exact;
  return projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

export function configFilename(): string {
  return CONFIG_FILENAME;
}
