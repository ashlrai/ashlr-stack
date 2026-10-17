/**
 * MCP tool catalog for ashlr-stack-mcp. Each tool maps 1:1 onto a `stack`
 * CLI invocation; `cliArgs` builds the argv. Kept separate from server.ts
 * (which connects stdio at import time) so the catalog is unit-testable.
 */

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  cliArgs: (input: Record<string, unknown>) => string[];
}

export const TOOLS: ToolDef[] = [
  {
    name: "stack_init",
    description:
      "Scaffold .stack.toml in the current directory; a selected template may also run provider setup.",
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
    description:
      "Import nonempty new variables from an .env file into Phantom and record detected services; existing vault names are left unchanged.",
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
      // Always --json: MCP has no TTY, and without it `stack scan` only prints
      // a "no TTY detected" hint. --json is read-only (no prompts, no add).
      const args = ["scan", "--json"];
      if (input.path) args.push("--path", String(input.path));
      if (input.confidence) args.push("--confidence", String(input.confidence));
      return args;
    },
  },
  {
    name: "stack_add",
    description:
      "Run provider-specific service setup or attach an existing resource, then record returned secret slots and optional MCP configuration. Credentials and client/provider acceptance must be checked separately.",
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
    description:
      "Remove local service configuration and its MCP entry, and attempt Phantom secret cleanup. Upstream resources are kept; headless cleanup or refused confirmation can leave secrets stored.",
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
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description: "Machine-readable JSON (schema ashlr.stack.list/v1).",
        },
      },
    },
    cliArgs: (input) => (input.json ? ["list", "--json"] : ["list"]),
  },
  {
    name: "stack_info",
    description:
      "Inspect configured resource, auth kind, secret-name inventory and MCP metadata; attempt a healthcheck when the provider supports one.",
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
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description: "Machine-readable JSON (schema ashlr.stack.status/v1).",
        },
      },
    },
    cliArgs: (input) => (input.json ? ["status", "--json"] : ["status"]),
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
    description:
      "Inspect the configured-service health report. --fix attempts supported remediation; stored vault names can cause repairs to be skipped, and name presence is not credential validity.",
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
    description:
      "Forward a deployment-platform sync request to phantom sync; inspect the installed Phantom command support and result separately.",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string", description: "One of: vercel, railway, fly." },
      },
      required: ["platform"],
    },
    cliArgs: (input) => ["sync", "--platform", String(input.platform)],
  },
  {
    name: "stack_providers",
    description:
      "List the curated source provider catalog by category; inclusion does not attest complete provisioning or active credentials.",
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description: "Machine-readable JSON (schema ashlr.stack.providers/v1).",
        },
      },
    },
    cliArgs: (input) => (input.json ? ["providers", "--json"] : ["providers"]),
  },
  {
    name: "stack_projects_list",
    description:
      "List projects recorded in the local Stack registry; this is not a filesystem-wide discovery scan.",
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description: "Machine-readable JSON (schema ashlr.stack.projects/v1).",
        },
      },
    },
    cliArgs: (input) => (input.json ? ["projects", "list", "--json"] : ["projects", "list"]),
  },
  {
    name: "stack_deps",
    description: "Show the service dependency graph for the current stack.",
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description: "Machine-readable JSON (schema ashlr.stack.deps/v1).",
        },
      },
    },
    cliArgs: (input) => (input.json ? ["deps", "--json"] : ["deps"]),
  },
  {
    name: "stack_templates_list",
    description: "List available starter stack templates.",
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description:
            "Machine-readable JSON (schema ashlr.stack.templates/v1): each template with its services, providers and secret names.",
        },
      },
    },
    cliArgs: (input) => (input.json ? ["templates", "list", "--json"] : ["templates", "list"]),
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
      "Retrieve scored curated-provider matches and per-category ranking for a query. save:true writes a Recipe for a later stack_apply request. The CLI JSON payload is forwarded as text; this tool does not request LLM inference.",
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
            "Optional filter to a source catalog category: Database, Deploy, Cloud, AI, Analytics, Observability, Errors, Payments, Code, Tickets, Email, Auth, FeatureFlags. Matched case-insensitively; an unknown category is an error.",
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
      "Apply a saved Recipe through provider setup, then report which declared secrets are in the Phantom vault and which are missing (names only; it never writes to the vault) and write webhook stubs. Inspect failures and skips. no_wire:true skips the vault check and stubs, not provider credential writes.",
    inputSchema: {
      type: "object",
      properties: {
        recipe_id: {
          type: "string",
          description: "Recipe id (filename stem in .stack/recipes/).",
        },
        no_wire: {
          type: "boolean",
          description: "Skip the Phantom vault check and webhook stubs.",
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

/**
 * Check a tools/call payload against the tool's inputSchema before any argv is
 * built. Returns an error message, or null when the input is usable.
 *
 * Without this a missing required field reached the CLI as the literal string
 * "undefined" (`stack add undefined`), and a value starting with "-" was parsed
 * as a flag: `stack_remove {"service":"--all"}` ran `stack remove --all` and
 * removed every service instead of one.
 */
export function validateToolInput(tool: ToolDef, input: Record<string, unknown>): string | null {
  for (const key of tool.inputSchema.required ?? []) {
    const value = input[key];
    if (value === undefined || value === null || value === "") {
      return `${tool.name}: missing required argument "${key}".`;
    }
  }
  for (const [key, value] of Object.entries(input)) {
    const spec = tool.inputSchema.properties[key];
    if (!spec || value === undefined || value === null) continue;
    const actual = typeof value;
    if (spec.type === "number" ? !Number.isFinite(value) : actual !== spec.type) {
      return `${tool.name}: argument "${key}" must be a ${spec.type}.`;
    }
    if (actual === "string" && (value as string).startsWith("-")) {
      return `${tool.name}: argument "${key}" must not start with "-" (it would be read as a CLI flag).`;
    }
  }
  return null;
}
