/**
 * Per-call working directory for project-scoped tools.
 *
 * An MCP host often starts the server outside the project (Claude Desktop, a
 * global Cursor config), so project-scoped tools take an optional absolute
 * `cwd` and the spawned `stack` runs there. The directory is resolved with
 * realpath and must be an existing directory; it is the same trust level as
 * the server's own working directory (any directory the server user can
 * already read), nothing more.
 */

import { lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ToolDef } from "./tools.ts";
import { validateToolInput } from "./tools.ts";

/** True when the tool declares the optional `cwd` input. */
export function acceptsCwd(tool: ToolDef): boolean {
  return "cwd" in tool.inputSchema.properties;
}

/**
 * Validate `input.cwd` for `tool`. Returns `{ cwd }` (realpath, or undefined
 * when not given, meaning the server's own working directory) or `{ error }`.
 */
export function resolveToolCwd(
  tool: ToolDef,
  input: Record<string, unknown>,
): { cwd: string | undefined; error?: undefined } | { cwd?: undefined; error: string } {
  const raw = input.cwd;
  if (raw === undefined || raw === null) return { cwd: undefined };
  if (!acceptsCwd(tool)) {
    return {
      error: `${tool.name}: argument "cwd" is not supported by this tool; it is not project-scoped and runs in the server's working directory.`,
    };
  }
  if (typeof raw !== "string") return { error: `${tool.name}: argument "cwd" must be a string.` };
  if (raw === "" || !isAbsolute(raw)) {
    return {
      error: `${tool.name}: argument "cwd" must be an absolute path (got ${JSON.stringify(raw)}).`,
    };
  }
  let real: string;
  try {
    real = realpathSync(raw);
  } catch {
    return {
      error: `${tool.name}: cwd ${JSON.stringify(raw)} does not exist or cannot be resolved.`,
    };
  }
  let isDir = false;
  try {
    isDir = statSync(real).isDirectory();
  } catch {
    // treated as not a directory
  }
  if (!isDir) return { error: `${tool.name}: cwd ${JSON.stringify(raw)} is not a directory.` };
  return { cwd: real };
}

/**
 * Everything the server needs to run one tools/call: the `stack` argv and the
 * directory to run it in, or the error to return without running anything.
 */
export function planToolCall(
  tool: ToolDef,
  input: Record<string, unknown>,
): { ok: true; args: string[]; cwd: string | undefined } | { ok: false; error: string } {
  // `cwd` on a tool that does not declare it gets resolveToolCwd's specific
  // "not project-scoped" error rather than the generic unknown-argument one,
  // so validate the remaining arguments without it.
  const rest = acceptsCwd(tool)
    ? input
    : Object.fromEntries(Object.entries(input).filter(([key]) => key !== "cwd"));
  const invalid = validateToolInput(tool, rest);
  if (invalid) return { ok: false, error: invalid };
  const resolved = resolveToolCwd(tool, input);
  if (resolved.error !== undefined) return { ok: false, error: resolved.error };
  const pathKey =
    tool.name === "stack_scan" ? "path" : tool.name === "stack_import" ? "from" : null;
  const project = resolved.cwd ?? process.cwd();
  if (pathKey) {
    const value = input[pathKey] ?? (pathKey === "path" ? "." : ".env");
    const error = validateProjectPath(tool, pathKey, String(value), project);
    if (error) return { ok: false, error };
  }
  if (tool.name === "stack_apply" && typeof input.recipe_id === "string") {
    if (!/^[a-zA-Z0-9_-]+$/.test(input.recipe_id)) {
      return {
        ok: false,
        error: `${tool.name}: argument "recipe_id" must be a filename stem using letters, numbers, underscores or hyphens.`,
      };
    }
    const error = validateProjectPath(
      tool,
      "recipe_id",
      `.stack/recipes/${input.recipe_id}.toml`,
      project,
    );
    if (error) return { ok: false, error };
  }
  return { ok: true, args: tool.cliArgs(input), cwd: resolved.cwd };
}

// Resolve the nearest existing ancestor so missing files retain CLI usage errors,
// while a symlinked parent cannot redirect reads outside the selected project.
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A dangling symlink is not a missing ordinary file. Refuse it rather
    // than assuming that its target will eventually be inside the project.
    try {
      if (lstatSync(path).isSymbolicLink()) throw error;
    } catch (statError) {
      if (statError === error || (statError as NodeJS.ErrnoException).code !== "ENOENT") {
        throw statError;
      }
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(canonicalPath(parent), relative(parent, path));
  }
}

function validateProjectPath(
  tool: ToolDef,
  key: string,
  value: string,
  project: string,
): string | null {
  try {
    const root = realpathSync(project);
    const target = canonicalPath(isAbsolute(value) ? value : `${root}${sep}${value}`);
    const suffix = relative(root, target);
    if (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)) return null;
  } catch {
    return `${tool.name}: argument "${key}" cannot be resolved; use a valid path inside the project directory.`;
  }
  return `${tool.name}: argument "${key}" must stay inside the project directory (got ${JSON.stringify(value)}); use a path relative to cwd within the project.`;
}
