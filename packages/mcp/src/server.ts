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

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  cliArgs: (input: Record<string, unknown>) => string[];
}

const TOOLS: ToolDef[] = [
  {
    name: "stack_init",
    description: "Scaffold a new .stack.toml in the current directory.",
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string", description: "Optional starter template name." },
        force: { type: "boolean", description: "Overwrite an existing .stack.toml." },
      },
    },
    cliArgs: (input) => {
      const args = ["init", "--noInteractive"];
      if (input.template) args.push("--template", String(input.template));
      if (input.force) args.push("--force");
      return args;
    },
  },
  {
    name: "stack_import",
    description: "Import an existing .env file into Phantom + .stack.toml.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Path to the .env file (default: .env)." },
        dryRun: { type: "boolean", description: "Preview without writing." },
      },
    },
    cliArgs: (input) => {
      const args = ["import"];
      if (input.from) args.push("--from", String(input.from));
      if (input.dryRun) args.push("--dryRun");
      return args;
    },
  },
  {
    name: "stack_scan",
    description:
      "Detect providers this repo uses by reading package.json / requirements.txt / config files.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to scan (default: cwd)." },
        confidence: {
          type: "string",
          description: "Minimum confidence: low, medium, or high (default: medium).",
        },
      },
    },
    cliArgs: (input) => {
      const args = ["scan"];
      if (input.path) args.push("--path", String(input.path));
      if (input.confidence) args.push("--confidence", String(input.confidence));
      return args;
    },
  },
  {
    name: "stack_add",
    description: "Provision a service and wire its secrets + MCP entry.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name (e.g. supabase, neon, vercel)." },
        use: { type: "string", description: "Existing resource id to attach to." },
      },
      required: ["service"],
    },
    cliArgs: (input) => {
      const args = ["add", String(input.service)];
      if (input.use) args.push("--use", String(input.use));
      return args;
    },
  },
  {
    name: "stack_remove",
    description: "Remove a service from the stack (vault entries and MCP config).",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        keepRemote: { type: "boolean" },
      },
      required: ["service"],
    },
    cliArgs: (input) => {
      const args = ["remove", String(input.service)];
      if (input.keepRemote) args.push("--keepRemote");
      return args;
    },
  },
  {
    name: "stack_list",
    description: "List services configured in this stack.",
    inputSchema: { type: "object", properties: {} },
    cliArgs: () => ["list"],
  },
  {
    name: "stack_info",
    description:
      "Deep-dive on a single service: resource, region, auth, secrets, MCP wiring, health.",
    inputSchema: {
      type: "object",
      properties: { service: { type: "string" } },
      required: ["service"],
    },
    cliArgs: (input) => ["info", String(input.service)],
  },
  {
    name: "stack_status",
    description: "Show Phantom + services + config at a glance.",
    inputSchema: { type: "object", properties: {} },
    cliArgs: () => ["status"],
  },
  {
    name: "stack_env_show",
    description: "Show which declared secrets are present in the Phantom vault (masked).",
    inputSchema: { type: "object", properties: {} },
    cliArgs: () => ["env", "show"],
  },
  {
    name: "stack_env_diff",
    description: "Report which declared secrets are missing from the Phantom vault.",
    inputSchema: { type: "object", properties: {} },
    cliArgs: () => ["env", "diff"],
  },
  {
    name: "stack_doctor",
    description: "Verify every service is reachable and credentials are valid.",
    inputSchema: {
      type: "object",
      properties: {
        fix: { type: "boolean", description: "Attempt auto-remediation." },
        all: { type: "boolean", description: "Run across every registered project." },
        json: { type: "boolean", description: "Machine-readable JSON output." },
      },
    },
    cliArgs: (input) => {
      const args = ["doctor"];
      if (input.fix) args.push("--fix");
      if (input.all) args.push("--all");
      if (input.json) args.push("--json");
      return args;
    },
  },
  {
    name: "stack_sync",
    description: "Push secrets to a deployment platform (via `phantom sync`).",
    inputSchema: {
      type: "object",
      properties: { platform: { type: "string" } },
      required: ["platform"],
    },
    cliArgs: (input) => ["sync", "--platform", String(input.platform)],
  },
  {
    name: "stack_providers",
    description: "List every curated provider Stack can wire up (grouped by category).",
    inputSchema: { type: "object", properties: {} },
    cliArgs: () => ["providers"],
  },
  {
    name: "stack_projects_list",
    description: "List every Stack-enabled project on this machine.",
    inputSchema: { type: "object", properties: {} },
    cliArgs: () => ["projects", "list"],
  },
  {
    name: "stack_deps",
    description: "Show the service dependency graph for the current stack.",
    inputSchema: { type: "object", properties: {} },
    cliArgs: () => ["deps"],
  },
  {
    name: "stack_templates_list",
    description: "List available starter stack templates.",
    inputSchema: { type: "object", properties: {} },
    cliArgs: () => ["templates", "list"],
  },
  {
    name: "stack_upgrade",
    description: "Check npm for a newer @ashlr/stack release.",
    inputSchema: { type: "object", properties: {} },
    cliArgs: () => ["upgrade"],
  },
  {
    name: "stack_recommend",
    description:
      "Given a free-text description of what the user is building (e.g. 'B2B SaaS with auth, AI, and payments'), return a structured list of the most relevant curated providers with scores, matched terms, and per-category ranking. Pass save:true to also persist a Recipe to .stack/recipes/<id>.toml so you (Claude) can follow up with stack_apply. Retrieval-only — no LLM inference happens here.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language description of the project / stack need.",
        },
        k: {
          type: "number",
          description: "Max top-level hits to return (default 6).",
        },
        category: {
          type: "string",
          description:
            "Optional filter to a single category: Database, Deploy, Cloud, AI, Analytics, Errors, Payments, Code, Tickets, Email, Auth.",
        },
        save: {
          type: "boolean",
          description:
            "When true, also freeze the result to .stack/recipes/<id>.toml so you can run stack_apply. Returns the recipe id in the response.",
        },
      },
      required: ["query"],
    },
    cliArgs: (input) => {
      const args = ["recommend", String(input.query ?? ""), "--json"];
      if (input.k) args.push("--k", String(input.k));
      if (input.category) args.push("--category", String(input.category));
      if (input.save) args.push("--save");
      return args;
    },
  },
  {
    name: "stack_apply",
    description:
      "Apply a saved Recipe: replay `stack add` for each provider, then pre-wire Phantom rotation envelopes + webhook stubs. Set `no_wire: true` to opt out of the Phantom-wire layer (stays pure-provisioning).",
    inputSchema: {
      type: "object",
      properties: {
        recipe_id: {
          type: "string",
          description: "Recipe id (filename stem in .stack/recipes/).",
        },
        no_wire: {
          type: "boolean",
          description: "Skip Phantom envelope + webhook pre-wiring.",
        },
      },
      required: ["recipe_id"],
    },
    cliArgs: (input) => {
      const args = ["apply", String(input.recipe_id)];
      if (input.no_wire) args.push("--noWire");
      return args;
    },
  },
];

const STACK_BIN = process.env.STACK_BIN ?? "stack";

function runStack(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(STACK_BIN, args, {
      env: { ...process.env, NO_COLOR: "1", CI: "1" },
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
          ? `The 'stack' CLI is not on PATH. Install it (bun add -g @ashlr/stack) or set STACK_BIN to an absolute path.`
          : (err as Error).message;
      resolve({ stdout: "", stderr: hint, code: 127 });
    });
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

const server = new Server(
  { name: "ashlr-stack", version: "0.2.0" },
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
  const args = tool.cliArgs(input);
  const { stdout, stderr, code } = await runStack(args);
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
      description: "Committed shape of the current project's stack.",
      mimeType: "application/toml",
    });
  }
  if (existsSync(join(cwd, ".stack.local.toml"))) {
    resources.push({
      uri: "stack://current/.stack.local.toml",
      name: ".stack.local.toml (local instance)",
      description: "Local instance data (resource ids, project_id). Gitignored.",
      mimeType: "application/toml",
    });
  }
  if (existsSync(join(cwd, ".mcp.json"))) {
    resources.push({
      uri: "stack://current/.mcp.json",
      name: ".mcp.json (MCP wiring)",
      description: "Currently-wired MCP servers.",
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
