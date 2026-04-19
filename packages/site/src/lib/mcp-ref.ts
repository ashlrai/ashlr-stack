/**
 * MCP tool reference — mirrors `packages/mcp/src/server.ts` `TOOLS`.
 *
 * Stack ships an MCP server that exposes the CLI as a set of tools any
 * MCP-capable LLM client (Claude Code, Cursor, Windsurf, Zed) can call.
 * Each entry below is one tool.
 */

export interface McpToolInput {
  name: string;
  type: "string" | "boolean";
  required?: boolean;
  description: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputs: McpToolInput[];
  /** The underlying CLI the tool dispatches to (illustrative). */
  cli: string;
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "stack_init",
    description: "Scaffold a new .stack.toml in the current directory.",
    inputs: [
      {
        name: "template",
        type: "string",
        description: "Optional starter template name.",
      },
      {
        name: "force",
        type: "boolean",
        description: "Overwrite an existing .stack.toml.",
      },
    ],
    cli: "stack init --noInteractive [--template <name>] [--force]",
  },
  {
    name: "stack_import",
    description: "Import an existing .env file into Phantom + .stack.toml.",
    inputs: [
      { name: "from", type: "string", description: "Path to the .env file (default: .env)." },
      { name: "dryRun", type: "boolean", description: "Preview without writing." },
    ],
    cli: "stack import [--from <path>] [--dryRun]",
  },
  {
    name: "stack_scan",
    description:
      "Detect providers this repo uses by reading package.json / requirements.txt / config files.",
    inputs: [
      { name: "path", type: "string", description: "Directory to scan (default: cwd)." },
      {
        name: "confidence",
        type: "string",
        description: "Minimum confidence: low, medium, or high (default: medium).",
      },
    ],
    cli: "stack scan [--path <dir>] [--confidence low|medium|high]",
  },
  {
    name: "stack_add",
    description: "Provision a service and wire its secrets + MCP entry.",
    inputs: [
      {
        name: "service",
        type: "string",
        required: true,
        description: "Service name (e.g. supabase, neon, vercel).",
      },
      { name: "use", type: "string", description: "Existing resource id to attach to." },
    ],
    cli: "stack add <service> [--use <id>]",
  },
  {
    name: "stack_remove",
    description: "Remove a service from the stack (vault entries and MCP config).",
    inputs: [
      { name: "service", type: "string", required: true, description: "Service name." },
      {
        name: "keepRemote",
        type: "boolean",
        description: "Leave the provider-side resource untouched.",
      },
    ],
    cli: "stack remove <service> [--keepRemote]",
  },
  {
    name: "stack_list",
    description: "List services configured in this stack.",
    inputs: [],
    cli: "stack list",
  },
  {
    name: "stack_info",
    description:
      "Deep-dive on a single service: resource, region, auth, secrets, MCP wiring, health.",
    inputs: [
      { name: "service", type: "string", required: true, description: "Service name." },
    ],
    cli: "stack info <service>",
  },
  {
    name: "stack_status",
    description: "Show Phantom + services + config at a glance.",
    inputs: [],
    cli: "stack status",
  },
  {
    name: "stack_env_show",
    description: "Show which declared secrets are present in the Phantom vault (masked).",
    inputs: [],
    cli: "stack env show",
  },
  {
    name: "stack_env_diff",
    description: "Report which declared secrets are missing from the Phantom vault.",
    inputs: [],
    cli: "stack env diff",
  },
  {
    name: "stack_doctor",
    description: "Verify every service is reachable and credentials are valid.",
    inputs: [
      { name: "fix", type: "boolean", description: "Attempt auto-remediation." },
      { name: "all", type: "boolean", description: "Run across every registered project." },
      { name: "json", type: "boolean", description: "Machine-readable JSON output." },
    ],
    cli: "stack doctor [--fix] [--all] [--json]",
  },
  {
    name: "stack_sync",
    description: "Push secrets to a deployment platform (via phantom sync).",
    inputs: [
      {
        name: "platform",
        type: "string",
        required: true,
        description: "One of: vercel, railway, fly.",
      },
    ],
    cli: "stack sync --platform <name>",
  },
  {
    name: "stack_providers",
    description: "List every curated provider Stack can wire up (grouped by category).",
    inputs: [],
    cli: "stack providers",
  },
  {
    name: "stack_projects_list",
    description: "List every Stack-enabled project on this machine.",
    inputs: [],
    cli: "stack projects list",
  },
  {
    name: "stack_deps",
    description: "Show the service dependency graph for the current stack.",
    inputs: [],
    cli: "stack deps",
  },
  {
    name: "stack_templates_list",
    description: "List available starter stack templates.",
    inputs: [],
    cli: "stack templates list",
  },
  {
    name: "stack_upgrade",
    description: "Check npm for a newer @ashlr/stack release.",
    inputs: [],
    cli: "stack upgrade",
  },
  {
    name: "stack_recommend",
    description:
      "Free-text → curated providers. Given a natural-language brief (e.g. 'B2B SaaS with auth, AI, and payments'), returns scored hits + a per-category ranking. Pass save:true to freeze as a Recipe and follow up with stack_apply.",
    inputs: [
      {
        name: "query",
        type: "string",
        required: true,
        description: "Natural-language description of the project / stack need.",
      },
      {
        name: "k",
        type: "string",
        description: "Max top-level hits to return (default 6).",
      },
      {
        name: "category",
        type: "string",
        description:
          "Optional filter to a single category (Database, Deploy, Cloud, AI, Analytics, Errors, Payments, Code, Tickets, Email, Auth).",
      },
      {
        name: "save",
        type: "boolean",
        description:
          "Freeze the result to .stack/recipes/<id>.toml so you can run stack_apply.",
      },
    ],
    cli: "stack recommend \"<query>\" --json [--k <n>] [--category <name>] [--save]",
  },
  {
    name: "stack_apply",
    description:
      "Replay a saved Recipe: run stack_add per provider, then pre-wire Phantom rotation envelopes + webhook stubs. Opt out of the wire step with no_wire:true.",
    inputs: [
      {
        name: "recipe_id",
        type: "string",
        required: true,
        description: "Recipe id (filename stem in .stack/recipes/).",
      },
      {
        name: "no_wire",
        type: "boolean",
        description: "Skip Phantom envelope + webhook pre-wiring.",
      },
    ],
    cli: "stack apply <recipe_id> [--noWire]",
  },
];

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/** The MCP server also exposes three read-only resources (no tool call needed). */
export const MCP_RESOURCES: McpResource[] = [
  {
    uri: "stack://current/.stack.toml",
    name: ".stack.toml (this project)",
    description: "Committed shape of the current project's stack.",
    mimeType: "application/toml",
  },
  {
    uri: "stack://current/.stack.local.toml",
    name: ".stack.local.toml (local instance)",
    description: "Local instance data (resource ids, project_id). Gitignored.",
    mimeType: "application/toml",
  },
  {
    uri: "stack://current/.mcp.json",
    name: ".mcp.json (MCP wiring)",
    description: "Currently-wired MCP servers.",
    mimeType: "application/json",
  },
];
