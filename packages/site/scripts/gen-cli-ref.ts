#!/usr/bin/env bun
/**
 * scripts/gen-cli-ref.ts
 *
 * Build-time generator for packages/site/src/lib/cli-ref.generated.ts.
 *
 * Imports each command module from packages/cli/src/commands/, extracts
 * meta.name, meta.description, and the args map, then emits a typed
 * TypeScript file with the same shape as the hand-maintained cli-ref.ts.
 *
 * Run:
 *   bun run scripts/gen-cli-ref.ts
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatGeneratedFiles, generateSiteFacts } from "./gen-site-facts.ts";

// ---------------------------------------------------------------------------
// Types (mirror the exported shape of cli-ref.ts)
// ---------------------------------------------------------------------------

interface CliFlag {
  name: string;
  synopsis: string;
  type: "string" | "boolean" | "positional";
  required?: boolean;
  default?: string | boolean;
  description: string;
}

interface CliCommand {
  name: string;
  description: string;
  synopsis: string;
  flags?: CliFlag[];
  subcommands?: CliCommand[];
  examples?: Array<{ title?: string; command: string; comment?: string }>;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// import.meta.dir is Bun's native equivalent of __dirname for the script file
const SCRIPT_DIR = (import.meta as { dir?: string }).dir ?? resolve(process.cwd());
const CLI_COMMANDS_DIR = resolve(SCRIPT_DIR, "../../cli/src/commands");
const OUT_PATH = resolve(SCRIPT_DIR, "../src/lib/cli-ref.generated.ts");

/** Map a citty arg type to our CliFlag type field. */
function mapType(arg: { type?: string }): "string" | "boolean" | "positional" {
  if (arg.type === "positional") return "positional";
  if (arg.type === "boolean") return "boolean";
  return "string";
}

/**
 * Build a synopsis string from command name + its args map.
 * Positional args appear as <name> or [name]; options as --flag [<val>].
 */
function buildSynopsis(cmdName: string, args: Record<string, ArgDef>): string {
  const parts: string[] = [cmdName];
  for (const [name, arg] of Object.entries(args)) {
    if (name === "_") continue;
    const ph = synopsisPlaceholder(name, arg);
    if (arg.type === "positional") {
      parts.push(arg.required ? `<${ph}>` : `[${ph}]`);
    } else if (arg.type === "boolean") {
      parts.push(`[--${name}]`);
    } else {
      parts.push(arg.required ? `--${name} <${ph}>` : `[--${name} <${ph}>]`);
    }
  }
  return parts.join(" ");
}

/**
 * Derive a human-readable placeholder from the first word of the description
 * or fall back to the arg name. E.g. "Path to the .env file" → "path".
 */
function synopsisPlaceholder(name: string, arg: ArgDef): string {
  // Common semantic overrides based on arg name
  const overrides: Record<string, string> = {
    use: "id",
    install: "mode",
    from: "path",
    platform: "name",
    confidence: "low|medium|high",
    recipeId: "id",
    target: "name|path",
    k: "n",
  };
  return overrides[name] ?? name;
}

/** Convert a citty args map into our CliFlag array. */
function buildFlags(args: Record<string, ArgDef>): CliFlag[] {
  return Object.entries(args)
    .filter(([name]) => name !== "_")
    .map(([name, arg]) => {
      const type = mapType(arg);
      const ph = synopsisPlaceholder(name, arg);
      const flag: CliFlag = {
        name,
        synopsis: flagSynopsis(name, type, ph, arg.required ?? false),
        type,
        description: arg.description ?? "",
      };
      if (arg.required !== undefined) flag.required = arg.required;
      if (arg.default !== undefined) flag.default = arg.default as string | boolean;
      return flag;
    });
}

/** Render the flag/positional synopsis cell, e.g. `<path>`, `[--flag]`, `--k <n>`. */
function flagSynopsis(
  name: string,
  type: "string" | "boolean" | "positional",
  placeholder: string,
  required: boolean,
): string {
  switch (type) {
    case "positional":
      return required ? `<${placeholder}>` : `[${placeholder}]`;
    case "boolean":
      return `--${name}`;
    default:
      return `--${name} <${placeholder}>`;
  }
}

// ---------------------------------------------------------------------------
// citty shape we care about (minimal types for extraction)
// ---------------------------------------------------------------------------

interface ArgDef {
  type?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
  alias?: string;
}

interface CommandDef {
  meta?: { name?: string; description?: string };
  args?: Record<string, ArgDef>;
  subCommands?: Record<string, CommandDef>;
}

// ---------------------------------------------------------------------------
// Per-command manual enrichment
// (examples, notes, and any synopsis overrides that aren't derivable from args)
// ---------------------------------------------------------------------------

interface CommandExtra {
  synopsis?: string;
  notes?: string;
  examples?: Array<{ title?: string; command: string; comment?: string }>;
  subcommandExtras?: Record<string, CommandExtra>;
}

const EXTRAS: Record<string, CommandExtra> = {
  "fleet-waste": {
    examples: [{ command: "stack fleet waste --json" }, { command: "stack fleet-waste --metrics ~/.ashlr-runs/metrics/jobs.jsonl --hours 6" }],
    notes: "Read-only JSON, including empty files. Defaults to ~/.ashlr-runs/metrics/jobs.jsonl. Inclusive trailing window, default one hour. Events use ISO ts (or timestamp), event, lane and job; finish.empty must be true to count as empty. Launches and empties count events; precheckSkip groups skips by code (unknown if absent/invalid). neverFinished counts unique jobs launched in the window without a finish at or after their latest launch, as of windowEnd; unfinishedJobs lists their ids. File order does not matter. Malformed rows are skipped and counted; unrelated events and out-of-window rows are ignored. Missing/unreadable files fail without exposing raw input.",
  },
  "fleet-silent": {
    examples: [{ command: "stack fleet-silent --runs /path/to/runs --json" }],
    notes: "Read-only JSON. Reads top-level *author*.log files, dispatchd.log, dispatch-events.log and metrics/jobs.jsonl; missing/invalid sources are reported, never treated as healthy. Inputs are JSONL or timestamped key=value lines (naive timestamps are local). Fully dated logs use event order; legacy undated logs use append order. Author summaries use status=ok to clear older failures; lane summaries use lane (or pool), need and picked. Reports the latest positive need with zero picks per lane, ten explicit empty:true finish events per lane, and no fleet-wide launch for at least 20 minutes of observed dispatch/job history. Launch/tick timestamps are required; ticks use a nonnegative launched count. Malformed inputs suppress latest/absence claims. FIXUP reuse means the same job id launched on distinct UTC days; finishes crossing midnight do not count. Metrics use event, job, lane, empty and timestamp (or ts). Reads are capped at 16 MiB per regular file; symlink files and raw log bodies are excluded.",
  },
  "fleet-collisions": {
    examples: [{ command: "locus exec -- gh pr list --state open --limit 1000 --json number,state,mergeable,files | stack fleet-collisions" }, { command: "stack fleet collisions --file prs.json" }],
    notes: "Read-only JSON for one repository per snapshot. Includes only OPEN, CONFLICTING PRs; UNKNOWN mergeability is excluded. Files rank by distinct PR count, then path. Paths are touched files, not confirmed conflict hunks. Counts cover only the supplied snapshot; ensure the gh limit covers all PRs. Empty input arrays yield files: []; invalid input exits nonzero.",
  },
  "fleet-reds": {
    examples: [{ command: "stack fleet-reds --json" }],
    notes: "Read-only via Locus. JSON is the default. For each of the seven fleet repositories, selects the latest completed workflow named CI on its default branch for each event (schedule and push), then lists failed jobs only when that run failed. A newer successful run clears older failures. no-runs means no completed run; unavailable and partial mean incomplete reads. firstFailingTest is null for unrecognized output or expired logs; logStatus distinguishes these cases. Parses Vitest, node:test TAP/spec and nextest text output. Raw logs and API errors are omitted.",
  },
  "fleet-lag": {
    examples: [{ command: "stack fleet-lag --json" }],
    notes: "Read-only via Locus. Latest tag is ordered by underlying commit date; age uses the annotated tagger date or lightweight commit date. Compares that tag to the default branch. Median seconds use the latest 20 merge timestamps across all base branches, or all merged PRs if fewer. No tags and unavailable repositories remain in the report; unknown metrics are null.",
  },
  "fleet-stuck": {
    examples: [{ command: "stack fleet-stuck --json" }],
    notes: "Read-only via Locus. JSON is the default. Lists every open PR, sorted by merge state then descending age in days since creation. Auto-merge-off path reasons identify server/ directories and common lockfiles, including renamed paths; these are hints, not GitHub's explanation. Empty repositories have prs: []; unavailable or incomplete reads have prs: null.",
  },
  "fleet-slo": {
    examples: [{ command: "stack fleet-slo --json" }, { command: "stack fleet slo --json" }],
    notes: "Read-only via Locus. The window is the last six hours. Merge volume, median and p90 open-to-merge seconds come from the same source as stack fleet-latency; open and conflicting PR counts come from a paginated open-PR scan that counts only GitHub-reported CONFLICTING nodes. Targets: 20 merges per window in ashlrai/phantom and a median open-to-merge of 300 seconds; unavailable metrics and inapplicable targets are null.",
  },
  "fleet-bets": {
    examples: [{ command: "stack fleet-bets --json" }],
    notes: "Read-only. Bets are job ids on `- STATUS <id> (attrs)` lines of the leader queue ledger whose attrs carry src=leader (`--src` selects another marker). Queue state comes from ready.tsv; launch, finish, publish and outcome events come from metrics/jobs.jsonl (tail-read at 32 MiB). Statuses: vanished (no trace), waiting (queued), running (launched), empty (resolved with no merge: empty finish, empty publish, precheck skip or a terminal non-merge outcome), open (PR open or unresolved non-empty work) and merged (outcome state MERGED). Ledger MERGED/LANDED/DONE/PR-OPEN statuses are fallbacks when local evidence is absent. mergedRate is merged over resolved (merged + empty) bets per lane; null when nothing resolved.",
  },
  fleet: {
    subcommandExtras: {
      waste: {
        examples: [{ command: "stack fleet waste --json" }],
        notes: "Read-only JSON. Same report, metrics path and window as stack fleet-waste.",
      },
      slo: {
        examples: [{ command: "stack fleet slo --json" }],
        notes: "Read-only via Locus. Same report as stack fleet-slo, nested under the fleet namespace.",
      },
    },
  },
  init: {
    examples: [
      { command: "stack init" },
      { command: "stack init --template nextjs-supabase-posthog", comment: "# apply a starter template up front" },
      { command: "stack init --noInteractive", comment: "# CI-safe blank init" },
    ],
    notes: "Warns (but proceeds) if Phantom isn't on $PATH. `stack add` requires Phantom; `stack init` does not.",
  },
  import: {
    examples: [
      { command: "stack import" },
      { command: "stack import --from .env.local --dryRun" },
    ],
    notes: "Routes every secret into Phantom, then best-guesses which provider each belongs to and writes matching service entries into .stack.toml.",
  },
  scan: {
    examples: [
      { command: "stack scan" },
      { command: "stack scan --auto --confidence high", comment: "# auto-wire only signals we're sure about" },
    ],
  },
  clone: {
    examples: [
      { command: "stack clone https://github.com/acme/webapp" },
      { command: "stack clone git@github.com:acme/webapp.git my-app" },
    ],
    notes: "After cloning, runs `stack scan` automatically. If the repo already ships a committed .stack.toml, it prints next-step guidance instead.",
  },
  add: {
    examples: [
      { command: "stack add supabase" },
      { command: "stack add neon --region us-east-2" },
      { command: "stack add vercel --use prj_abc123", comment: "# attach to an existing Vercel project" },
      { command: "stack add --dryRun" },
    ],
    notes: "Requires Phantom to be on $PATH. Runs the provider's four-step lifecycle: login → provision → materialize → persist.",
  },
  remove: {
    examples: [
      { command: "stack remove supabase" },
      { command: "stack remove --all --keepRemote" },
    ],
  },
  list: {
    examples: [
      { command: "stack list" },
      { command: "stack list --json", comment: "# ashlr.stack.list/v1 for agents" },
    ],
  },
  info: {
    examples: [{ command: "stack info supabase" }],
    notes: "Prints provider, resource id, region, secret slots (with vault presence), MCP wiring, dashboard URL, and runs a fresh healthcheck.",
  },
  status: {
    examples: [{ command: "stack status" }],
  },
  env: {
    subcommandExtras: {
      show: {
        examples: [{ command: "stack env show" }, { command: "stack env show --env prod" }],
      },
      export: {
        examples: [{ command: "stack env export --example" }, { command: "stack env export --stdout" }],
      },
      diff: {
        examples: [{ command: "stack env diff" }],
      },
    },
  },
  deps: {
    examples: [
      { command: "stack deps" },
      { command: "stack deps --json", comment: "# ashlr.stack.deps/v1 for agents" },
    ],
    notes: "Renders an ASCII tree grouped by category, with every secret slot annotated beneath its service.",
  },
  doctor: {
    examples: [
      { command: "stack doctor" },
      { command: "stack doctor --fix" },
      { command: "stack doctor --json > report.json", comment: "# CI-friendly" },
      { command: "stack doctor --all", comment: "# every Stack project on this box" },
    ],
  },
  exec: {
    examples: [
      { command: "stack exec -- bun dev" },
      { command: "stack exec -- npm test" },
    ],
    notes: "Thin wrapper over `phantom exec` so env vars with phm_ tokens get swapped for real secrets at the network layer.",
  },
  sync: {
    examples: [{ command: "stack sync --platform vercel" }],
  },
  onboard: {
    examples: [
      { command: "stack onboard", comment: "plan only, nothing is written" },
      { command: "stack onboard --apply" },
      { command: "stack onboard --undo" },
    ],
  },
  open: {
    examples: [
      { command: "stack open supabase" },
      { command: "stack open vercel" },
    ],
  },
  login: {
    examples: [
      { command: "stack login github" },
      { command: "stack login supabase" },
    ],
  },
  templates: {
    subcommandExtras: {
      list: {
        examples: [{ command: "stack templates list" }],
      },
      apply: {
        examples: [{ command: "stack templates apply nextjs-supabase-posthog" }],
      },
    },
  },
  providers: {
    examples: [
      { command: "stack providers" },
      { command: "stack providers --json", comment: "# ashlr.stack.providers/v1 for agents" },
    ],
  },
  recommend: {
    examples: [
      { command: "stack recommend \"next.js app with auth and postgres\"" },
      { command: "stack recommend --json \"realtime websockets\"" },
    ],
  },
  apply: {
    examples: [
      { command: "stack apply" },
      { command: "stack apply my-recipe" },
    ],
    notes: "The golden path is `stack recommend --save && stack apply <id>`. Auto-inits a blank .stack.toml if none exists.",
  },
  projects: {
    subcommandExtras: {
      list: {
        examples: [{ command: "stack projects list" }],
      },
      register: {
        examples: [{ command: "stack projects register" }],
      },
      remove: {
        examples: [{ command: "stack projects remove my-app" }],
      },
      where: {
        examples: [{ command: "cd $(stack projects where my-app)", comment: "# jump into a project by name" }],
      },
    },
  },
  upgrade: {
    examples: [{ command: "stack upgrade" }, { command: "stack upgrade --apply" }],
    notes: "Checks npm by default. --apply upgrades an npm global CLI install with local rollback on failed health checks; --dryRun never installs.",
  },
  completion: {
    examples: [
      { command: "stack completion zsh > ~/.local/share/zsh/site-functions/_stack" },
      { command: "stack completion bash | sudo tee /etc/bash_completion.d/stack" },
      { command: "stack completion fish > ~/.config/fish/completions/stack.fish" },
    ],
  },
  ci: {
    subcommandExtras: {
      init: {
        examples: [{ command: "stack ci init" }],
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function extractCommand(
  name: string,
  def: CommandDef,
  parentName: string | null,
  extra: CommandExtra | undefined,
): CliCommand {
  const fullName = parentName ? `${parentName} ${name}` : `stack ${name}`;
  const args = def.args ?? {};
  const flags = buildFlags(args);
  const synopsis = extra?.synopsis ?? buildSynopsis(fullName, args);

  const cmd: CliCommand = {
    name: fullName,
    description: def.meta?.description ?? "",
    synopsis,
  };

  if (flags.length > 0) cmd.flags = flags;

  if (def.subCommands && Object.keys(def.subCommands).length > 0) {
    const subExtras = extra?.subcommandExtras ?? {};
    cmd.subcommands = Object.entries(def.subCommands).map(([subName, subDef]) =>
      extractCommand(subName, subDef, fullName, subExtras[subName]),
    );
    // Build synopsis for parent showing sub-verb options
    const subVerbs = Object.keys(def.subCommands).join("|");
    cmd.synopsis = extra?.synopsis ?? `${fullName} <${subVerbs}>`;
  }

  if (extra?.examples) cmd.examples = extra.examples;
  if (extra?.notes) cmd.notes = extra.notes;

  return cmd;
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

function serializeValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function serializeFlag(f: CliFlag, indent: string): string {
  const lines: string[] = [`${indent}{`];
  lines.push(`${indent}  name: ${JSON.stringify(f.name)},`);
  lines.push(`${indent}  synopsis: ${JSON.stringify(f.synopsis)},`);
  lines.push(`${indent}  type: ${JSON.stringify(f.type)},`);
  if (f.required !== undefined) lines.push(`${indent}  required: ${f.required},`);
  if (f.default !== undefined) lines.push(`${indent}  default: ${serializeValue(f.default)},`);
  lines.push(`${indent}  description: ${JSON.stringify(f.description)},`);
  lines.push(`${indent}}`);
  return lines.join("\n");
}

function serializeExample(
  e: { title?: string; command: string; comment?: string },
  indent: string,
): string {
  const parts: string[] = [];
  if (e.title !== undefined) parts.push(`title: ${JSON.stringify(e.title)}`);
  parts.push(`command: ${JSON.stringify(e.command)}`);
  if (e.comment !== undefined) parts.push(`comment: ${JSON.stringify(e.comment)}`);
  return `${indent}{ ${parts.join(", ")} }`;
}

function serializeCommand(cmd: CliCommand, indent: string): string {
  const i = indent;
  const i2 = indent + "  ";
  const lines: string[] = [`${i}{`];
  lines.push(`${i2}name: ${JSON.stringify(cmd.name)},`);
  lines.push(`${i2}description: ${JSON.stringify(cmd.description)},`);
  lines.push(`${i2}synopsis: ${JSON.stringify(cmd.synopsis)},`);

  if (cmd.flags && cmd.flags.length > 0) {
    lines.push(`${i2}flags: [`);
    for (const f of cmd.flags) {
      lines.push(serializeFlag(f, i2 + "  ") + ",");
    }
    lines.push(`${i2}],`);
  }

  if (cmd.subcommands && cmd.subcommands.length > 0) {
    lines.push(`${i2}subcommands: [`);
    for (const sub of cmd.subcommands) {
      lines.push(serializeCommand(sub, i2 + "  ") + ",");
    }
    lines.push(`${i2}],`);
  }

  if (cmd.examples && cmd.examples.length > 0) {
    lines.push(`${i2}examples: [`);
    for (const e of cmd.examples) {
      lines.push(serializeExample(e, i2 + "  ") + ",");
    }
    lines.push(`${i2}],`);
  }

  if (cmd.notes !== undefined) {
    lines.push(`${i2}notes: ${JSON.stringify(cmd.notes)},`);
  }

  lines.push(`${i}}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Command order (matches index.ts subCommands order)
// ---------------------------------------------------------------------------

const COMMAND_ORDER = [
  "init",
  "import",
  "scan",
  "clone",
  "add",
  "remove",
  "list",
  "info",
  "status",
  "env",
  "deps",
  "doctor",
  "fleet-lanes",
  "fleet-supply",
  "fleet-latency",
  "fleet-lag",
  "fleet-waste",
  "fleet-reds",
  "fleet-silent",
  "fleet-collisions",
  "fleet-delivery-lag",
  "fleet-stuck",
  "fleet-slo",
  "fleet-act",
  "fleet-stream",
  "fleet-graph",
  "fleet-bets",
  "fleet",
  "exec",
  "swap",
  "sync",
  "onboard",
  "open",
  "login",
  "telemetry",
  "templates",
  "providers",
  "recommend",
  "apply",
  "projects",
  "ci",
  "completion",
  "upgrade",
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const commands: CliCommand[] = [];

  for (const name of COMMAND_ORDER) {
    const modPath = `${CLI_COMMANDS_DIR}/${name}.ts`;
    let mod: { default?: CommandDef; [key: string]: unknown };
    try {
      mod = await import(modPath);
    } catch (err) {
      console.warn(`  warn: could not import ${name}.ts — ${(err as Error).message}`);
      continue;
    }

    // Find the exported command def (named export ending in "Command", or default)
    let def: CommandDef | undefined;
    for (const [key, val] of Object.entries(mod)) {
      if (key === "default" && val && typeof val === "object" && "meta" in val) {
        def = val as CommandDef;
        break;
      }
      if (key.endsWith("Command") && val && typeof val === "object" && "meta" in val) {
        def = val as CommandDef;
        break;
      }
    }

    if (!def) {
      console.warn(`  warn: no command def found in ${name}.ts`);
      continue;
    }

    const cmd = extractCommand(name, def, null, EXTRAS[name]);
    commands.push(cmd);
    console.log(`  extracted: stack ${name}${def.subCommands ? ` (${Object.keys(def.subCommands).length} subcommands)` : ""}`);
  }

  // ---------------------------------------------------------------------------
  // Emit
  // ---------------------------------------------------------------------------

  const lines: string[] = [
    "// Generated by scripts/gen-cli-ref.ts. Do not edit by hand.",
    "// Re-run with: bun run scripts/gen-cli-ref.ts",
    "",
    "export interface CliFlag {",
    "  name: string;",
    "  /** The short synopsis shown beside the flag, e.g. `--template <name>`. */",
    "  synopsis: string;",
    '  type: "string" | "boolean" | "positional";',
    "  required?: boolean;",
    "  default?: string | boolean;",
    "  description: string;",
    "}",
    "",
    "export interface CliExample {",
    "  title?: string;",
    "  command: string;",
    "  comment?: string;",
    "}",
    "",
    "export interface CliCommand {",
    "  /** Full command as typed, e.g. `stack add`. */",
    "  name: string;",
    "  /** One-sentence description. */",
    "  description: string;",
    "  synopsis: string;",
    "  flags?: CliFlag[];",
    "  /** For commands with subcommands (env, templates, ci, projects). */",
    "  subcommands?: CliCommand[];",
    "  examples?: CliExample[];",
    "  /** Optional long-form notes — rendered as a paragraph under the header. */",
    "  notes?: string;",
    "}",
    "",
    "export const CLI_COMMANDS: CliCommand[] = [",
  ];

  for (const cmd of commands) {
    lines.push(serializeCommand(cmd, "  ") + ",");
  }

  lines.push("];", "");

  writeFileSync(OUT_PATH, lines.join("\n"), "utf-8");

  // Biome's line-wrap rules require multi-line breaks on long strings; run
  // the formatter over the output so the generated file always lands biome-clean.
  formatGeneratedFiles(["packages/site/src/lib/cli-ref.generated.ts"]);

  console.log(`\n  wrote ${OUT_PATH}`);
  console.log(`  ${commands.length} commands extracted.`);

  // packages/site/package.json is a frozen path, so this wired entry point
  // also runs the site freshness generator (version strings, install
  // commands, feature counts and MCP tool lists -> generated files).
  await generateSiteFacts();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
