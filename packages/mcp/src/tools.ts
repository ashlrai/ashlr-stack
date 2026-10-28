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

/**
 * Optional `cwd` input shared by every project-scoped tool (one that reads or
 * writes .stack.toml or other project files). Validated and resolved in
 * cwd.ts; `cliArgs` never sees it, the spawned `stack` runs in it instead.
 */
export const CWD_INPUT = {
  type: "string",
  description: "Existing absolute project directory; defaults to server cwd.",
} as const;

export const TOOLS: ToolDef[] = [
  {
    name: "stack_init",
    description:
      "Scaffold .stack.toml in the current directory; a selected template may also run provider setup.",
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string", description: "Starter template name." },
        force: { type: "boolean", description: "Overwrite an existing .stack.toml." },
        cwd: CWD_INPUT,
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
      "Import nonempty new variables from an .env file into Phantom and record detected services; existing vault names are left unchanged. Returns ashlr.stack.import/v1 JSON naming what was stored, skipped and wired (names only, never values).",
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Path to the .env file inside the project (default: .env).",
        },
        dryRun: { type: "boolean", description: "Preview without writing." },
        cwd: CWD_INPUT,
      },
    },
    cliArgs: (input) => {
      // --json so the caller learns which names were stored and which were
      // skipped (already in the vault, or empty) instead of a summary count.
      const args = ["import", "--json"];
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
        path: {
          type: "string",
          description: "Directory to scan inside the project (default: cwd).",
        },
        confidence: {
          type: "string",
          description: "Minimum confidence: low, medium, or high (default: medium).",
        },
        cwd: CWD_INPUT,
      },
    },
    cliArgs: (input) => {
      // Always --json: without it `stack scan` prints a human report for a
      // person to read. --json is read-only (no prompts, no add).
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
        cwd: CWD_INPUT,
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
      "Remove local service configuration and its MCP entry, and attempt Phantom secret cleanup. Returns JSON (ashlr.stack.remove/v1); `secrets_kept` lists names Phantom left stored, which headless runs always do, for the user to remove with `phantom remove` in a terminal. Upstream resources are kept.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        keepRemote: { type: "boolean" },
        cwd: CWD_INPUT,
      },
      required: ["service"],
    },
    cliArgs: (input) => {
      // --json so the caller gets `secrets_kept` (Phantom removes nothing
      // headlessly) instead of a banner that reads like a full removal.
      const args = ["remove", String(input.service), "--json"];
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
          description: "JSON: ashlr.stack.list/v1.",
        },
        cwd: CWD_INPUT,
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
      properties: {
        service: { type: "string" },
        json: {
          type: "boolean",
          description: "JSON: ashlr.stack.info/v1.",
        },
        cwd: CWD_INPUT,
      },
      required: ["service"],
    },
    cliArgs: (input) => {
      const args = ["info", String(input.service)];
      if (input.json) args.push("--json");
      return args;
    },
  },
  {
    name: "stack_status",
    description: "Show Phantom + services + config at a glance.",
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description: "JSON: ashlr.stack.status/v1.",
        },
        cwd: CWD_INPUT,
      },
    },
    cliArgs: (input) => (input.json ? ["status", "--json"] : ["status"]),
  },
  {
    name: "stack_env_show",
    description: "Show which declared secrets are present in the Phantom vault (masked).",
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description: "JSON: ashlr.stack.env/v1; names only.",
        },
        cwd: CWD_INPUT,
      },
    },
    cliArgs: (input) => (input.json ? ["env", "show", "--json"] : ["env", "show"]),
  },
  {
    name: "stack_env_diff",
    description: "Report which declared secrets are missing from the Phantom vault.",
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description:
            "JSON: ashlr.stack.env-diff/v1; names and service only. Missing secrets remain an error.",
        },
        cwd: CWD_INPUT,
      },
    },
    cliArgs: (input) => (input.json ? ["env", "diff", "--json"] : ["env", "diff"]),
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
        json: { type: "boolean", description: "JSON output." },
        cwd: CWD_INPUT,
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
        cwd: CWD_INPUT,
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
        category: {
          type: "string",
          description: "Only this category, any case (e.g. ai, database, payments).",
        },
        json: {
          type: "boolean",
          description: "JSON: ashlr.stack.providers/v1.",
        },
      },
    },
    cliArgs: (input) => [
      "providers",
      ...(typeof input.category === "string" && input.category.trim()
        ? ["--category", input.category.trim()]
        : []),
      ...(input.json ? ["--json"] : []),
    ],
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
          description: "JSON: ashlr.stack.projects/v1.",
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
          description: "JSON: ashlr.stack.deps/v1.",
        },
        cwd: CWD_INPUT,
      },
    },
    cliArgs: (input) => (input.json ? ["deps", "--json"] : ["deps"]),
  },
  {
    name: "stack_templates_list",
    description: "List available starter stack templates and the services each one adds.",
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description: "JSON: ashlr.stack.templates/v1; services, providers and secret names.",
        },
      },
    },
    cliArgs: (input) => (input.json ? ["templates", "list", "--json"] : ["templates", "list"]),
  },
  {
    name: "stack_upgrade",
    description:
      "Check npm for a newer @ashlr/stack release. Returns ashlr.stack.upgrade/v1 JSON (current, latest, status, install command); installs nothing.",
    inputSchema: { type: "object", properties: {} },
    cliArgs: () => ["upgrade", "--json"],
  },
  {
    name: "stack_recommend",
    description:
      "Rank curated providers by query, returning JSON as text without LLM inference. save:true writes a Recipe for stack_apply.",
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
            "Category (case-insensitive): Database, Deploy, Cloud, AI, Analytics, Observability, Errors, Payments, Code, Tickets, Email, Auth, FeatureFlags. Unknown values error.",
        },
        save: {
          type: "boolean",
          description: "Save .stack/recipes/<id>.toml for stack_apply; returns recipe id.",
        },
        cwd: CWD_INPUT,
      },
      required: ["query"],
    },
    cliArgs: (input) => {
      const args = ["recommend", String(input.query ?? ""), "--json"];
      // `k: 0` used to be dropped (falsy) and the default of 6 was used. Pass
      // every number as `--k=<n>` so the CLI rejects 0, negatives and
      // fractions by value (a bare `-3` would be parsed as a flag).
      if (input.k !== undefined && input.k !== null) args.push(`--k=${input.k}`);
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
          description:
            "Recipe id (filename stem in .stack/recipes/, letters, numbers, underscores or hyphens).",
        },
        no_wire: {
          type: "boolean",
          description: "Skip the Phantom vault check and webhook stubs.",
        },
        cwd: CWD_INPUT,
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
 * removed every service instead of one. Keys the schema does not declare are
 * rejected rather than silently ignored.
 */
export function validateToolInput(tool: ToolDef, input: Record<string, unknown>): string | null {
  for (const key of tool.inputSchema.required ?? []) {
    const value = input[key];
    // A blank string (`"  "`) is as missing as an absent one: it used to run
    // `stack info "  "` or `stack sync --platform " "`.
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
      return `${tool.name}: missing required argument "${key}".`;
    }
  }
  for (const [key, value] of Object.entries(input)) {
    const spec = tool.inputSchema.properties[key];
    if (!spec) {
      // A misspelled key (`catgory` for `category`) used to be dropped and the
      // tool ran without it, reporting success on a request it never honored.
      const known = Object.keys(tool.inputSchema.properties);
      return `${tool.name}: unknown argument "${key}". ${
        known.length ? `Accepted: ${known.join(", ")}.` : "This tool takes no arguments."
      }`;
    }
    if (value === undefined || value === null) continue;
    const actual = typeof value;
    if (spec.type === "number" ? !Number.isFinite(value) : actual !== spec.type) {
      return `${tool.name}: argument "${key}" must be a ${spec.type}.`;
    }
    if (actual === "string" && value !== "" && !(value as string).trim()) {
      return `${tool.name}: argument "${key}" must not be blank.`;
    }
    if (actual === "string" && (value as string).startsWith("-")) {
      return `${tool.name}: argument "${key}" must not start with "-" (it would be read as a CLI flag).`;
    }
  }
  return null;
}
