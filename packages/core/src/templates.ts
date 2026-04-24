import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import type { StackConfig } from "./config.ts";

/**
 * Starter `.stack.toml` templates live in `templates/<name>/stack.toml` at the
 * monorepo root, and are also published with the CLI so `stack init --template`
 * works globally after install.
 */

export function resolveTemplatesDir(): string | undefined {
  const candidates = [
    // Explicit override — useful in tests or custom installs.
    process.env.STACK_TEMPLATES_DIR ?? "",
    resolve(join(process.cwd(), "templates")),
    // When running from source inside the monorepo (packages/core/src → root):
    resolve(join(fileURLToPath(dirname(import.meta.url)), "..", "..", "..", "templates")),
    // Legacy: one extra level up (kept for backward compat with old dist layouts).
    resolve(join(fileURLToPath(dirname(import.meta.url)), "..", "..", "..", "..", "templates")),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

export function listTemplates(): string[] {
  const dir = resolveTemplatesDir();
  if (!dir) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function loadTemplate(name: string): Promise<StackConfig | undefined> {
  const dir = resolveTemplatesDir();
  if (!dir) return undefined;
  const path = join(dir, name, "stack.toml");
  if (!existsSync(path)) return undefined;
  const raw = await readFile(path, "utf-8");
  return parseToml(raw) as unknown as StackConfig;
}
