import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerEntry } from "./providers/_base.ts";

const MCP_FILENAME = ".mcp.json";

interface McpFile {
  mcpServers: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export async function mergeMcpEntry(
  entry: McpServerEntry,
  cwd: string = process.cwd(),
): Promise<void> {
  const path = join(cwd, MCP_FILENAME);
  const current = await readMcp(path);
  current.mcpServers[entry.name] = toJsonShape(entry);
  await writeFile(path, `${JSON.stringify(current, null, 2)}\n`, "utf-8");
}

export async function removeMcpEntry(name: string, cwd: string = process.cwd()): Promise<void> {
  const path = join(cwd, MCP_FILENAME);
  if (!existsSync(path)) return;
  const current = await readMcp(path);
  if (current.mcpServers[name]) {
    delete current.mcpServers[name];
    await writeFile(path, `${JSON.stringify(current, null, 2)}\n`, "utf-8");
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
