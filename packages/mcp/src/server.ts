#!/usr/bin/env bun
/**
 * ashlr-stack MCP server.
 *
 * Exposes every major `stack` CLI command as an MCP tool, plus the current
 * project's .stack.toml as an MCP resource so Claude can read it without a
 * tool call. Keeps the server thin — all behaviour lives in the CLI.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { planToolCall } from "./cwd.ts";
import { readServerVersion, resolveStackCommand } from "./stack-bin.ts";
import { TOOLS } from "./tools.ts";

const STACK = resolveStackCommand();

function runStack(
  args: string[],
  cwd: string | undefined,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(STACK.command, [...STACK.prefixArgs, ...args], {
      // A project-scoped tool's validated `cwd` (realpath); otherwise inherit
      // the server's own working directory.
      cwd,
      env: { ...process.env, ...(cwd ? { PWD: cwd } : {}), NO_COLOR: "1", CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      // Surface PATH/spawn failures as a structured text result rather than
      // rejecting — the MCP caller gets a clear "is `stack` on your PATH?"
      // hint instead of an opaque tool-execution error.
      const code = (err as NodeJS.ErrnoException).code;
      const hint =
        code === "ENOENT"
          ? `Could not run the 'stack' CLI (${STACK.command}). Reinstall ashlr-stack-mcp (it depends on @ashlr/stack), install @ashlr/stack globally, or set STACK_BIN to an absolute path.`
          : (err as Error).message;
      resolve({ stdout: "", stderr: hint, code: 127 });
    });
    child.on("close", (code, signal) =>
      resolve({ stdout, stderr, code: signal || code === null ? 1 : code }),
    );
  });
}

const server = new Server(
  { name: "ashlr-stack", version: readServerVersion() },
  { capabilities: { tools: {}, resources: {} } },
);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }
  const input = (request.params.arguments ?? {}) as Record<string, unknown>;
  const plan = planToolCall(tool, input);
  if (!plan.ok) {
    return { content: [{ type: "text", text: plan.error }], isError: true };
  }
  const { args, cwd } = plan;
  const { stdout, stderr, code } = await runStack(args, cwd);
  const body = stdout.trim() + (stderr.trim() ? `\n\n[stderr]\n${stderr.trim()}` : "");
  return {
    content: [{ type: "text", text: body || `(stack ${args.join(" ")} exit ${code})` }],
    isError: code !== 0,
  };
});

// ---------------------------------------------------------------------------
// Resources — let Claude read .stack.toml without a tool call
// ---------------------------------------------------------------------------

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources: Array<{
    uri: string;
    name: string;
    description: string;
    mimeType: string;
  }> = [];
  const cwd = process.cwd();
  if (existsSync(join(cwd, ".stack.toml"))) {
    resources.push({
      uri: "stack://current/.stack.toml",
      name: ".stack.toml (this project)",
      description:
        "Project configuration text when the file exists in server cwd; Git commit state is not verified and reads are not redacted.",
      mimeType: "application/toml",
    });
  }
  if (existsSync(join(cwd, ".stack.local.toml"))) {
    resources.push({
      uri: "stack://current/.stack.local.toml",
      name: ".stack.local.toml (local instance)",
      description:
        "Local instance data when the file exists in server cwd; inspect contents and project ignore rules before exposing raw text.",
      mimeType: "application/toml",
    });
  }
  if (existsSync(join(cwd, ".mcp.json"))) {
    resources.push({
      uri: "stack://current/.mcp.json",
      name: ".mcp.json (MCP wiring)",
      description:
        "MCP configuration text when the file exists in server cwd; client loading and usable credentials are not verified.",
      mimeType: "application/json",
    });
  }
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const match = uri.match(/^stack:\/\/current\/(.+)$/);
  if (!match) {
    throw new Error(`Unknown resource uri: ${uri}`);
  }
  const rel = match[1];
  if (![".stack.toml", ".stack.local.toml", ".mcp.json"].includes(rel)) {
    throw new Error(`Refusing to read: ${rel}`);
  }
  const path = join(process.cwd(), rel);
  if (!existsSync(path)) throw new Error(`${rel} does not exist in cwd.`);
  const text = readFileSync(path, "utf-8");
  return {
    contents: [
      {
        uri,
        mimeType: rel.endsWith(".json") ? "application/json" : "application/toml",
        text,
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
