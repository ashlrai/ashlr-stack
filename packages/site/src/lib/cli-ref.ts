/**
 * CLI reference data — one entry per top-level `stack` command.
 *
 * Derived from `packages/cli/src/commands/*.ts` (citty `defineCommand` calls).
 * If you change a command's flags there, mirror it here so the docs page
 * stays in sync.
 */

export interface CliFlag {
  name: string;
  /** The short synopsis shown beside the flag, e.g. `--template <name>`. */
  synopsis: string;
  type: "string" | "boolean" | "positional";
  required?: boolean;
  default?: string | boolean;
  description: string;
}

export interface CliExample {
  title?: string;
  command: string;
  comment?: string;
}

export interface CliCommand {
  /** Full command as typed, e.g. `stack add`. */
  name: string;
  /** One-sentence description. */
  description: string;
  synopsis: string;
  flags?: CliFlag[];
  /** For commands with subcommands (env, templates, ci, projects). */
  subcommands?: CliCommand[];
  examples?: CliExample[];
  /** Optional long-form notes — rendered as a paragraph under the header. */
  notes?: string;
}

export const CLI_COMMANDS: CliCommand[] = [
  {
    name: "stack init",
    description: "Scaffold a .stack.toml in the current directory.",
    synopsis: "stack init [--template <name>] [--force] [--noInteractive]",
    flags: [
      {
        name: "template",
        synopsis: "--template <name>",
        type: "string",
        description:
          "Name of a starter template to apply (e.g. nextjs-supabase-posthog). Omit to pick one interactively.",
      },
      {
        name: "force",
        synopsis: "--force",
        type: "boolean",
        default: false,
        description: "Overwrite an existing .stack.toml.",
      },
      {
        name: "noInteractive",
        synopsis: "--noInteractive",
        type: "boolean",
        default: false,
        description: "Skip the template picker — always create a blank .stack.toml.",
      },
    ],
    examples: [
      { command: "stack init" },
      {
        command: "stack init --template nextjs-supabase-posthog",
        comment: "# apply a starter template up front",
      },
      {
        command: "stack init --noInteractive",
        comment: "# CI-safe blank init",
      },
    ],
    notes:
      "Warns (but proceeds) if Phantom isn't on $PATH. `stack add` requires Phantom; `stack init` does not.",
  },
  {
    name: "stack import",
    description: "Import an existing .env into Phantom + .stack.toml.",
    synopsis: "stack import [--from <path>] [--dryRun]",
    flags: [
      {
        name: "from",
        synopsis: "--from <path>",
        type: "string",
        default: ".env",
        description: "Path to the .env file to import.",
      },
      {
        name: "dryRun",
        synopsis: "--dryRun",
        type: "boolean",
        default: false,
        description: "Print what would happen without writing anything.",
      },
    ],
    examples: [
      { command: "stack import" },
      { command: "stack import --from .env.local --dryRun" },
    ],
    notes:
      "Routes every secret into Phantom, then best-guesses which provider each belongs to and writes matching service entries into .stack.toml.",
  },
  {
    name: "stack scan",
    description:
      "Detect providers used by this repo (package.json, config files, .env.example).",
    synopsis: "stack scan [--path <dir>] [--auto] [--confidence low|medium|high]",
    flags: [
      {
        name: "path",
        synopsis: "--path <dir>",
        type: "string",
        default: ".",
        description: "Directory to scan.",
      },
      {
        name: "auto",
        synopsis: "--auto",
        type: "boolean",
        default: false,
        description:
          "After scanning, offer to run `stack add` for each detected provider interactively.",
      },
      {
        name: "confidence",
        synopsis: "--confidence <low|medium|high>",
        type: "string",
        default: "medium",
        description: "Minimum confidence to surface.",
      },
    ],
    examples: [
      { command: "stack scan" },
      {
        command: "stack scan --auto --confidence high",
        comment: "# auto-wire only signals we're sure about",
      },
    ],
  },
  {
    name: "stack clone",
    description: "Clone a GitHub repo and auto-detect its Stack services.",
    synopsis: "stack clone <git-url> [dir]",
    flags: [
      {
        name: "url",
        synopsis: "<git-url>",
        type: "positional",
        required: true,
        description:
          "GitHub / git URL to clone. Only https://, http://, ssh://, and git@host:org/repo forms are allowed.",
      },
      {
        name: "dir",
        synopsis: "[dir]",
        type: "positional",
        required: false,
        description: "Optional target directory (defaults to the repo name).",
      },
    ],
    examples: [
      { command: "stack clone https://github.com/acme/webapp" },
      {
        command: "stack clone git@github.com:acme/webapp.git my-app",
      },
    ],
    notes:
      "After cloning, runs `stack scan` automatically. If the repo already ships a committed .stack.toml, it prints next-step guidance instead.",
  },
  {
    name: "stack add",
    description: "Provision a service and wire its secrets + MCP entry.",
    synopsis: "stack add [service] [--use <id>] [--region <r>] [--dryRun]",
    flags: [
      {
        name: "service",
        synopsis: "[service]",
        type: "positional",
        required: false,
        description:
          "Service name (supabase, neon, vercel, …). Omit for the interactive picker.",
      },
      {
        name: "use",
        synopsis: "--use <id>",
        type: "string",
        description:
          "Attach to an existing resource by id instead of creating a new one.",
      },
      {
        name: "region",
        synopsis: "--region <r>",
        type: "string",
        description: "Region hint for providers that need one (e.g. us-east-1).",
      },
      {
        name: "dryRun",
        synopsis: "--dryRun",
        type: "boolean",
        default: false,
        description:
          "Preview what would happen — no network calls, no vault writes, no MCP edits.",
      },
    ],
    examples: [
      { command: "stack add supabase" },
      { command: "stack add neon --region us-east-2" },
      {
        command: "stack add vercel --use prj_abc123",
        comment: "# attach to an existing Vercel project",
      },
      { command: "stack add --dryRun" },
    ],
    notes:
      "Requires Phantom to be on $PATH. Runs the provider's four-step lifecycle: login → provision → materialize → persist.",
  },
  {
    name: "stack remove",
    description: "Remove a service from the stack (vault entries and MCP config).",
    synopsis: "stack remove [service] [--all] [--keepRemote]",
    flags: [
      {
        name: "service",
        synopsis: "[service]",
        type: "positional",
        required: false,
        description:
          "Service name. Omit with --all to remove every service in this stack.",
      },
      {
        name: "all",
        synopsis: "--all",
        type: "boolean",
        default: false,
        description:
          "Remove every service in this stack. Requires typing `remove all` to confirm.",
      },
      {
        name: "keepRemote",
        synopsis: "--keepRemote",
        type: "boolean",
        default: false,
        description: "Leave the provider-side resource untouched.",
      },
    ],
    examples: [
      { command: "stack remove supabase" },
      { command: "stack remove --all --keepRemote" },
    ],
  },
  {
    name: "stack list",
    description: "List services configured in this stack.",
    synopsis: "stack list",
    examples: [{ command: "stack list" }],
  },
  {
    name: "stack info",
    description: "Show everything Stack knows about a configured service.",
    synopsis: "stack info <service>",
    flags: [
      {
        name: "service",
        synopsis: "<service>",
        type: "positional",
        required: true,
        description: "Service name.",
      },
    ],
    examples: [{ command: "stack info supabase" }],
    notes:
      "Prints provider, resource id, region, secret slots (with vault presence), MCP wiring, dashboard URL, and runs a fresh healthcheck.",
  },
  {
    name: "stack status",
    description: "Show stack health at a glance.",
    synopsis: "stack status",
    examples: [{ command: "stack status" }],
  },
  {
    name: "stack env",
    description: "Inspect the effective env-var map for this stack.",
    synopsis: "stack env <show|diff>",
    subcommands: [
      {
        name: "stack env show",
        description: "Show which secrets are present in Phantom.",
        synopsis: "stack env show [--env <name>]",
        flags: [
          {
            name: "env",
            synopsis: "--env <name>",
            type: "string",
            default: "dev",
            description: "Environment overlay to preview.",
          },
        ],
        examples: [
          { command: "stack env show" },
          { command: "stack env show --env prod" },
        ],
      },
      {
        name: "stack env diff",
        description: "Which declared secrets are missing from the vault?",
        synopsis: "stack env diff",
        examples: [{ command: "stack env diff" }],
      },
    ],
  },
  {
    name: "stack deps",
    description: "Show the service dependency graph for this stack.",
    synopsis: "stack deps",
    examples: [{ command: "stack deps" }],
    notes:
      "Renders an ASCII tree grouped by category, with every secret slot annotated beneath its service.",
  },
  {
    name: "stack doctor",
    description: "Verify every service is reachable and credentials are valid.",
    synopsis: "stack doctor [--fix] [--all] [--json]",
    flags: [
      {
        name: "fix",
        synopsis: "--fix",
        type: "boolean",
        default: false,
        description:
          "Attempt auto-remediation by re-running `stack add` for failing services (asks before each).",
      },
      {
        name: "all",
        synopsis: "--all",
        type: "boolean",
        default: false,
        description: "Run doctor across every registered project on this machine.",
      },
      {
        name: "json",
        synopsis: "--json",
        type: "boolean",
        default: false,
        description:
          "Emit machine-readable JSON to stdout. Exit code: 0 if all healthy, 1 if any service failed.",
      },
    ],
    examples: [
      { command: "stack doctor" },
      { command: "stack doctor --fix" },
      {
        command: "stack doctor --json > report.json",
        comment: "# CI-friendly",
      },
      {
        command: "stack doctor --all",
        comment: "# every Stack project on this box",
      },
    ],
  },
  {
    name: "stack exec",
    description: "Run a command with Phantom's secret proxy active.",
    synopsis: "stack exec -- <command>",
    examples: [
      { command: "stack exec -- bun dev" },
      { command: "stack exec -- npm test" },
    ],
    notes:
      "Thin wrapper over `phantom exec` so env vars with phm_ tokens get swapped for real secrets at the network layer.",
  },
  {
    name: "stack sync",
    description: "Push secrets to a deployment platform (via phantom sync).",
    synopsis: "stack sync --platform <vercel|railway|fly>",
    flags: [
      {
        name: "platform",
        synopsis: "--platform <name>",
        type: "string",
        required: true,
        description: "One of: vercel, railway, fly.",
      },
    ],
    examples: [{ command: "stack sync --platform vercel" }],
  },
  {
    name: "stack open",
    description: "Open a service's dashboard in your browser.",
    synopsis: "stack open <service>",
    flags: [
      {
        name: "service",
        synopsis: "<service>",
        type: "positional",
        required: true,
        description: "Service name.",
      },
    ],
    examples: [
      { command: "stack open supabase" },
      { command: "stack open vercel" },
    ],
  },
  {
    name: "stack login",
    description: "Refresh OAuth / PAT credentials for a specific provider.",
    synopsis: "stack login <service>",
    flags: [
      {
        name: "service",
        synopsis: "<service>",
        type: "positional",
        required: true,
        description: "Provider name.",
      },
    ],
    examples: [
      { command: "stack login github" },
      { command: "stack login supabase" },
    ],
  },
  {
    name: "stack templates",
    description: "List or apply starter stack templates.",
    synopsis: "stack templates <list|apply>",
    subcommands: [
      {
        name: "stack templates list",
        description: "List available templates.",
        synopsis: "stack templates list",
        examples: [{ command: "stack templates list" }],
      },
      {
        name: "stack templates apply",
        description:
          "Apply a template — runs `stack add` for each service listed in the template.",
        synopsis: "stack templates apply <name> [--continueOnError]",
        flags: [
          {
            name: "name",
            synopsis: "<name>",
            type: "positional",
            required: true,
            description: "Template name.",
          },
          {
            name: "continueOnError",
            synopsis: "--continueOnError",
            type: "boolean",
            default: true,
            description: "Keep going when a single service fails.",
          },
        ],
        examples: [
          { command: "stack templates apply nextjs-supabase-posthog" },
        ],
      },
    ],
  },
  {
    name: "stack providers",
    description: "List every curated provider Stack can wire up.",
    synopsis: "stack providers",
    examples: [{ command: "stack providers" }],
  },
  {
    name: "stack projects",
    description: "Manage the cross-project registry at ~/.stack/projects.json.",
    synopsis: "stack projects <list|register|remove|where>",
    subcommands: [
      {
        name: "stack projects list",
        description: "List every Stack-enabled project on this machine.",
        synopsis: "stack projects list",
        examples: [{ command: "stack projects list" }],
      },
      {
        name: "stack projects register",
        description: "Register the current directory in the registry.",
        synopsis: "stack projects register",
        examples: [{ command: "stack projects register" }],
      },
      {
        name: "stack projects remove",
        description: "Remove a project from the registry (does not delete files).",
        synopsis: "stack projects remove <name|path>",
        flags: [
          {
            name: "target",
            synopsis: "<name|path>",
            type: "positional",
            required: true,
            description: "Project name or absolute path.",
          },
        ],
        examples: [{ command: "stack projects remove my-app" }],
      },
      {
        name: "stack projects where",
        description: "Print the path of a registered project.",
        synopsis: "stack projects where <name>",
        flags: [
          {
            name: "name",
            synopsis: "<name>",
            type: "positional",
            required: true,
            description: "Project name.",
          },
        ],
        examples: [
          {
            command: "cd $(stack projects where my-app)",
            comment: "# jump into a project by name",
          },
        ],
      },
    ],
  },
  {
    name: "stack upgrade",
    description: "Check npm for a newer @ashlr/stack release.",
    synopsis: "stack upgrade",
    examples: [{ command: "stack upgrade" }],
    notes:
      "Checks the npm registry for a newer version, prints an install hint — does not auto-install.",
  },
  {
    name: "stack completion",
    description: "Emit shell completion for bash, zsh, or fish.",
    synopsis: "stack completion <bash|zsh|fish>",
    flags: [
      {
        name: "shell",
        synopsis: "<bash|zsh|fish>",
        type: "positional",
        required: true,
        description: "Shell to emit completion for.",
      },
    ],
    examples: [
      {
        command: "stack completion zsh > ~/.local/share/zsh/site-functions/_stack",
      },
      {
        command: "stack completion bash | sudo tee /etc/bash_completion.d/stack",
      },
      {
        command: "stack completion fish > ~/.config/fish/completions/stack.fish",
      },
    ],
  },
  {
    name: "stack ci",
    description: "Scaffold CI integrations that run `stack doctor` on pushes + nightly.",
    synopsis: "stack ci <init>",
    subcommands: [
      {
        name: "stack ci init",
        description: "Write .github/workflows/stack-ci.yml for GitHub Actions.",
        synopsis: "stack ci init [--force]",
        flags: [
          {
            name: "force",
            synopsis: "--force",
            type: "boolean",
            default: false,
            description: "Overwrite an existing stack-ci.yml.",
          },
        ],
        examples: [{ command: "stack ci init" }],
      },
    ],
  },
];
