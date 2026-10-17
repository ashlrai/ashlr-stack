/**
 * MCP tool reference — mirrors `packages/mcp/src/tools.ts` `TOOLS`.
 *
 * Stack ships an MCP server that exposes the CLI as a set of tools any
 * configured MCP-capable client may request; CLI/runtime/cwd setup is separate.
 * Each entry below is one tool.
 */

export interface McpToolInput {
  name: string;
  type: "string" | "boolean" | "number";
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
    description:
      "Scaffold .stack.toml in the current directory; a selected template may also run provider setup.",
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
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack init --noInteractive [--template <name>] [--force]",
  },
  {
    name: "stack_import",
    description:
      "Import nonempty new variables from an .env file into Phantom and record detected services; existing vault names are left unchanged.",
    inputs: [
      { name: "from", type: "string", description: "Path to the .env file (default: .env)." },
      { name: "dryRun", type: "boolean", description: "Preview without writing." },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
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
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack scan [--path <dir>] [--confidence low|medium|high]",
  },
  {
    name: "stack_add",
    description:
      "Run provider-specific service setup or attach an existing resource, then record returned secret slots and optional MCP configuration. Credentials and client/provider acceptance must be checked separately.",
    inputs: [
      {
        name: "service",
        type: "string",
        required: true,
        description: "Service name (e.g. supabase, neon, vercel).",
      },
      { name: "use", type: "string", description: "Existing resource id to attach to." },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack add <service> [--use <id>]",
  },
  {
    name: "stack_remove",
    description:
      "Remove local service configuration and its MCP entry, and attempt Phantom secret cleanup. Upstream resources are kept; headless cleanup or refused confirmation can leave secrets stored.",
    inputs: [
      { name: "service", type: "string", required: true, description: "Service name." },
      {
        name: "keepRemote",
        type: "boolean",
        description:
          "Accepted and forwarded flag; this CLI performs local removal without upstream deletion either way.",
      },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack remove <service> [--keepRemote]",
  },
  {
    name: "stack_list",
    description: "List services configured in this stack.",
    inputs: [
      {
        name: "json",
        type: "boolean",
        description: "Machine-readable JSON (schema ashlr.stack.list/v1).",
      },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack list [--json]",
  },
  {
    name: "stack_info",
    description:
      "Inspect configured resource, auth kind, secret-name inventory and MCP metadata; attempt a healthcheck when the provider supports one.",
    inputs: [
      { name: "service", type: "string", required: true, description: "Service name." },
      {
        name: "json",
        type: "boolean",
        description: "Machine-readable JSON (schema ashlr.stack.info/v1).",
      },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack info <service> [--json]",
  },
  {
    name: "stack_status",
    description: "Show Phantom + services + config at a glance.",
    inputs: [
      {
        name: "json",
        type: "boolean",
        description: "Machine-readable JSON (schema ashlr.stack.status/v1).",
      },
    ],
    cli: "stack status [--json]",
  },
  {
    name: "stack_env_show",
    description: "Show which declared secrets are present in the Phantom vault (masked).",
    inputs: [
      {
        name: "json",
        type: "boolean",
        description: "Machine-readable JSON (schema ashlr.stack.env/v1, names only).",
      },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack env show [--json]",
  },
  {
    name: "stack_env_diff",
    description: "Report which declared secrets are missing from the Phantom vault.",
    inputs: [
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack env diff",
  },
  {
    name: "stack_doctor",
    description:
      "Inspect the configured-service health report. --fix attempts supported remediation; stored vault names can cause repairs to be skipped, and name presence is not credential validity.",
    inputs: [
      { name: "fix", type: "boolean", description: "Attempt auto-remediation." },
      { name: "all", type: "boolean", description: "Run across every registered project." },
      { name: "json", type: "boolean", description: "Machine-readable JSON output." },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack doctor [--fix] [--all] [--json]",
  },
  {
    name: "stack_sync",
    description:
      "Forward a deployment-platform sync request to phantom sync; inspect the installed Phantom command support and result separately.",
    inputs: [
      {
        name: "platform",
        type: "string",
        required: true,
        description: "One of: vercel, railway, fly.",
      },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack sync --platform <name>",
  },
  {
    name: "stack_providers",
    description:
      "List the curated source provider catalog by category; inclusion does not attest complete provisioning or active credentials.",
    inputs: [
      {
        name: "json",
        type: "boolean",
        description: "Machine-readable JSON (schema ashlr.stack.providers/v1).",
      },
    ],
    cli: "stack providers [--json]",
  },
  {
    name: "stack_projects_list",
    description:
      "List projects recorded in the local Stack registry; this is not a filesystem-wide discovery scan.",
    inputs: [
      {
        name: "json",
        type: "boolean",
        description: "Machine-readable JSON (schema ashlr.stack.projects/v1).",
      },
    ],
    cli: "stack projects list [--json]",
  },
  {
    name: "stack_deps",
    description: "Show the service dependency graph for the current stack.",
    inputs: [
      {
        name: "json",
        type: "boolean",
        description: "Machine-readable JSON (schema ashlr.stack.deps/v1).",
      },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: "stack deps [--json]",
  },
  {
    name: "stack_templates_list",
    description: "List available starter stack templates and the services each one adds.",
    inputs: [
      {
        name: "json",
        type: "boolean",
        description:
          "Machine-readable JSON (schema ashlr.stack.templates/v1): each template with its services, providers and secret names.",
      },
    ],
    cli: "stack templates list [--json]",
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
      "Retrieve scored curated-provider matches and per-category ranking for a query. save:true writes a Recipe for a later stack_apply request. The CLI JSON payload is forwarded as text; this tool does not request LLM inference.",
    inputs: [
      {
        name: "query",
        type: "string",
        required: true,
        description: "Natural-language description of the project / stack need.",
      },
      {
        name: "k",
        type: "number",
        description: "Max top-level hits to return (default 6).",
      },
      {
        name: "category",
        type: "string",
        description:
          "Optional filter to a source catalog category: Database, Deploy, Cloud, AI, Analytics, Observability, Errors, Payments, Code, Tickets, Email, Auth, FeatureFlags. The server input is a string, not an enforced enum.",
      },
      {
        name: "save",
        type: "boolean",
        description: "Freeze the result to .stack/recipes/<id>.toml so you can run stack_apply.",
      },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
      },
    ],
    cli: 'stack recommend "<query>" --json [--k <n>] [--category <name>] [--save]',
  },
  {
    name: "stack_apply",
    description:
      "Apply a saved Recipe through provider setup, then report which declared secrets are in the Phantom vault and which are missing (names only; it never writes to the vault) and write webhook stubs. Inspect failures and skips. no_wire:true skips the vault check and stubs, not provider credential writes.",
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
        description: "Skip optional Phantom wiring and webhook stubs.",
      },
      {
        name: "cwd",
        type: "string",
        description:
          "Absolute path of the project directory to run in (default: the MCP server's working directory). Must be an existing directory.",
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

/** Up to three read-only resources are advertised when their files exist in server cwd. */
export const MCP_RESOURCES: McpResource[] = [
  {
    uri: "stack://current/.stack.toml",
    name: ".stack.toml (this project)",
    description:
      "Project configuration text when the file exists in server cwd; Git commit state is not verified and reads are not redacted.",
    mimeType: "application/toml",
  },
  {
    uri: "stack://current/.stack.local.toml",
    name: ".stack.local.toml (local instance)",
    description:
      "Local instance data when the file exists in server cwd; inspect contents and project ignore rules before exposing raw text.",
    mimeType: "application/toml",
  },
  {
    uri: "stack://current/.mcp.json",
    name: ".mcp.json (MCP wiring)",
    description:
      "MCP configuration text when the file exists in server cwd; client loading and usable credentials are not verified.",
    mimeType: "application/json",
  },
];
