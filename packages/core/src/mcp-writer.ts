import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerEntry } from "./providers/_base.ts";

const MCP_FILENAME = ".mcp.json";

interface McpFile {
  mcpServers: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Other MCP clients that read a project-level `mcpServers` JSON file. Stack
 * mirrors entries into these only when the client's directory already exists
 * in the project (the user opted into that client); it never creates them.
 */
const MIRROR_TARGETS = [
  { client: "cursor", dir: ".cursor", file: "mcp.json" },
  { client: "gemini", dir: ".gemini", file: "settings.json" },
] as const;

type MirrorClient = (typeof MIRROR_TARGETS)[number]["client"];

export async function mergeMcpEntry(
  entry: McpServerEntry,
  cwd: string = process.cwd(),
): Promise<void> {
  const path = join(cwd, MCP_FILENAME);
  const current = await readMcp(path);
  const previous = current.mcpServers[entry.name];
  current.mcpServers[entry.name] = toJsonShape(entry);
  await writeFile(path, `${JSON.stringify(current, null, 2)}\n`, "utf-8");

  for (const t of MIRROR_TARGETS) {
    if (!existsSync(join(cwd, t.dir))) continue;
    const target = join(cwd, t.dir, t.file);
    try {
      const doc = await readMcp(target);
      const next = toClientShape(entry, t.client);
      const existing = doc.mcpServers[entry.name];
      // Client configs are user-owned: replace a same-name entry only when it
      // is what Stack itself mirrored (now or from the previous .mcp.json
      // entry). A hand-written entry is left as it is.
      if (existing !== undefined) {
        if (sameJson(existing, next)) continue;
        const mirrored = previous && toClientShape(asEntry(entry.name, previous), t.client);
        if (!mirrored || !sameJson(existing, mirrored)) continue;
      }
      doc.mcpServers[entry.name] = next;
      await writeFile(target, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
    } catch {
      // A client file Stack cannot parse is left untouched: .mcp.json is the
      // source of truth and a broken sibling must not fail provisioning.
    }
  }
}

export async function removeMcpEntry(name: string, cwd: string = process.cwd()): Promise<void> {
  const path = join(cwd, MCP_FILENAME);
  if (!existsSync(path)) return;
  const current = await readMcp(path);
  const previous = current.mcpServers[name];
  if (previous) {
    delete current.mcpServers[name];
    await writeFile(path, `${JSON.stringify(current, null, 2)}\n`, "utf-8");
  }
  // Without a .mcp.json entry there is nothing to prove a client entry of the
  // same name was written by Stack, so the client configs are not touched.
  if (!previous) return;

  for (const t of MIRROR_TARGETS) {
    const target = join(cwd, t.dir, t.file);
    if (!existsSync(target)) continue;
    try {
      const doc = await readMcp(target);
      const existing = doc.mcpServers[name];
      if (existing && sameJson(existing, toClientShape(asEntry(name, previous), t.client))) {
        delete doc.mcpServers[name];
        await writeFile(target, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
      }
    } catch {
      // Unparseable sibling config: leave it alone.
    }
  }
}

async function readMcp(path: string): Promise<McpFile> {
  if (!existsSync(path)) return { mcpServers: {} };
  const raw = await readFile(path, "utf-8");
  try {
    const parsed = JSON.parse(raw) as Partial<McpFile>;
    return { ...parsed, mcpServers: parsed.mcpServers ?? {} };
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
  }
}

function toJsonShape(entry: McpServerEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (entry.type) out.type = entry.type;
  if (entry.command) out.command = entry.command;
  if (entry.args) out.args = entry.args;
  if (entry.url) out.url = entry.url;
  if (entry.env) out.env = entry.env;
  if (entry.headers) out.headers = entry.headers;
  return out;
}

/**
 * Gemini CLI names remote transports differently: `httpUrl` for streamable
 * HTTP and `url` for SSE, and it has no `type` field. Cursor accepts the
 * generic shape.
 */
function toClientShape(entry: McpServerEntry, client: MirrorClient): Record<string, unknown> {
  if (client !== "gemini") return toJsonShape(entry);
  const out: Record<string, unknown> = {};
  if (entry.command) out.command = entry.command;
  if (entry.args) out.args = entry.args;
  if (entry.url) out[entry.type === "http" ? "httpUrl" : "url"] = entry.url;
  if (entry.env) out.env = entry.env;
  if (entry.headers) out.headers = entry.headers;
  return out;
}

/** Rebuild an entry from its `.mcp.json` shape (the inverse of toJsonShape). */
function asEntry(name: string, json: Record<string, unknown>): McpServerEntry {
  return { ...json, name } as McpServerEntry;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([k, val]) => [k, sortKeys(val)]),
    );
  }
  return v;
}
