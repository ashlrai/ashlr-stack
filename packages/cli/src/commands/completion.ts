import { listProviderNames, listTemplates } from "@ashlr/stack-core";
import { defineCommand } from "citty";

/**
 * `stack completion <shell>` — emit a shell completion script. Runtime-static
 * (we bake the command list + the currently-installed provider / template
 * names when it runs). Users re-run this after adding a new shell.
 *
 *   stack completion bash > /etc/bash_completion.d/stack
 *   stack completion zsh > ~/.local/share/zsh/site-functions/_stack
 *   stack completion fish > ~/.config/fish/completions/stack.fish
 *
 * The command metadata below is the single source of truth for completions.
 * Each entry mirrors the citty defineCommand args in the corresponding file.
 * When adding a new command or flag, update CMD_META here.
 */

// ---------------------------------------------------------------------------
// Command metadata map
// ---------------------------------------------------------------------------

interface FlagMeta {
  /** CLI flag name (without --) */
  name: string;
  /** If set, offer these literal values for the flag argument */
  values?: string[];
}

interface CmdMeta {
  /** Subcommands (e.g. telemetry status|enable|disable) */
  subcommands?: string[];
  /** Boolean and string flags (without leading --) */
  flags?: FlagMeta[];
  /** Whether the first positional arg should be completed from providers */
  completesProviders?: boolean;
}

const CMD_META: Record<string, CmdMeta> = {
  init: {
    flags: [
      { name: "template" },
      { name: "force" },
      { name: "noInteractive" },
      { name: "noProvision" },
      { name: "dryRun" },
      { name: "noRollback" },
    ],
  },
  import: {
    flags: [{ name: "from" }, { name: "dryRun" }],
  },
  scan: {
    flags: [
      { name: "path" },
      { name: "auto" },
      { name: "yes" },
      { name: "confidence", values: ["low", "medium", "high"] },
      { name: "json" },
    ],
  },
  clone: {
    // positional: url, dir — no enumerable completions
  },
  add: {
    completesProviders: true,
    flags: [
      { name: "use" },
      { name: "region" },
      { name: "dryRun" },
      { name: "install", values: ["ask", "always", "never"] },
    ],
  },
  remove: {
    completesProviders: true,
    flags: [{ name: "all" }, { name: "allOrphans" }, { name: "keepRemote" }],
  },
  list: {},
  info: {
    completesProviders: true,
  },
  status: {},
  env: {
    subcommands: ["show", "diff", "export"],
  },
  deps: {},
  doctor: {
    flags: [{ name: "fix" }, { name: "all" }, { name: "json" }, { name: "reconcile" }],
  },
  exec: {},
  sync: {
    flags: [{ name: "platform", values: ["vercel", "railway", "fly"] }],
  },
  open: {
    completesProviders: true,
  },
  login: {
    completesProviders: true,
  },
  templates: {
    subcommands: ["list", "apply"],
  },
  providers: {},
  recommend: {
    flags: [
      { name: "k" },
      { name: "category" },
      { name: "json" },
      { name: "save" },
      { name: "synth" },
    ],
  },
  apply: {
    flags: [{ name: "noWire" }, { name: "noRollback" }],
  },
  swap: {
    completesProviders: true,
    flags: [{ name: "dryRun" }, { name: "noRollback" }, { name: "keepFrom" }],
  },
  telemetry: {
    subcommands: ["status", "enable", "disable"],
  },
  projects: {
    subcommands: ["list", "register", "remove", "where"],
  },
  upgrade: {},
  ci: {
    subcommands: ["init"],
  },
  completion: {
    // positional: shell — handled specially in each emitter
  },
};

// Canonical command order (mirrors index.ts subCommands order)
const COMMANDS = [
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
  "exec",
  "sync",
  "open",
  "login",
  "templates",
  "providers",
  "recommend",
  "apply",
  "swap",
  "telemetry",
  "projects",
  "upgrade",
  "ci",
  "completion",
];

export const completionCommand = defineCommand({
  meta: {
    name: "completion",
    description: "Emit shell completion for bash, zsh, or fish.",
  },
  args: {
    shell: {
      type: "positional",
      required: true,
      description: "One of: bash, zsh, fish.",
    },
  },
  async run({ args }) {
    const shell = String(args.shell).toLowerCase();
    const providers = listProviderNames();
    const templates = listTemplates();

    if (shell === "bash") process.stdout.write(emitBash(providers, templates));
    else if (shell === "zsh") process.stdout.write(emitZsh(providers, templates));
    else if (shell === "fish") process.stdout.write(emitFish(providers, templates));
    else {
      process.stderr.write(`Unsupported shell: ${shell}. Use bash, zsh, or fish.\n`);
      process.exit(1);
    }
  },
});

// ---------------------------------------------------------------------------
// bash
// ---------------------------------------------------------------------------

function emitBash(providers: string[], templates: string[]): string {
  const allFlags = (cmd: string): string => {
    const meta = CMD_META[cmd];
    if (!meta?.flags) return "";
    return meta.flags.map((f) => `--${f.name}`).join(" ");
  };

  const flagValueCases = COMMANDS.flatMap((cmd) => {
    const flags = CMD_META[cmd]?.flags ?? [];
    return flags
      .filter((f) => f.values)
      .map(
        (f) =>
          `    --${f.name}) COMPREPLY=( $(compgen -W "${f.values!.join(" ")}" -- "\${cur}") ); return ;;`,
      );
  });

  const subCmdCases = COMMANDS.filter((cmd) => CMD_META[cmd]?.subcommands?.length).map((cmd) => {
    const subs = CMD_META[cmd]!.subcommands!;
    return `    ${cmd}) COMPREPLY=( $(compgen -W "${subs.join(" ")}" -- "\${cur}") ); return ;;`;
  });

  const providerCases = COMMANDS.filter((cmd) => CMD_META[cmd]?.completesProviders).join("|");

  return `# stack completion — bash
_stack_completion() {
  local cur prev words cword
  _init_completion || return

  if [[ \${cword} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${COMMANDS.join(" ")}" -- "\${cur}") )
    return
  fi

  # Complete flag values (e.g. --confidence <val>)
  case "\${prev}" in
${flagValueCases.join("\n")}
  esac

  local cmd="\${words[1]}"

  # Offer flags for the current command
  if [[ "\${cur}" == --* ]]; then
    case "\${cmd}" in
${COMMANDS.map((c) => `      ${c}) COMPREPLY=( $(compgen -W "${allFlags(c)}" -- "\${cur}") ); return ;;`).join("\n")}
    esac
    return
  fi

  # Subcommand / positional completions
  case "\${cmd}" in
${subCmdCases.join("\n")}
    ${providerCases || "add"}) COMPREPLY=( $(compgen -W "${providers.join(" ")}" -- "\${cur}") ); return ;;
    templates)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "list apply" -- "\${cur}") )
      elif [[ "\${words[2]}" == "apply" ]]; then
        COMPREPLY=( $(compgen -W "${templates.join(" ")}" -- "\${cur}") )
      fi
      return ;;
    completion) COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") ); return ;;
  esac
}
complete -F _stack_completion stack
`;
}

// ---------------------------------------------------------------------------
// zsh
// ---------------------------------------------------------------------------

function emitZsh(providers: string[], templates: string[]): string {
  const cmdDescriptions = COMMANDS.map((c) => `"${c}"`).join(" ");

  const flagSpecs = (cmd: string): string => {
    const flags = CMD_META[cmd]?.flags ?? [];
    if (flags.length === 0) return "";
    return `\n        ${flags
      .map((f) => {
        if (f.values) {
          return `'(--${f.name})--${f.name}[${f.name}]:value:(${f.values.join(" ")})'`;
        }
        return `'(--${f.name})--${f.name}[${f.name}]'`;
      })
      .join(" \\\n        ")}`;
  };

  const subCmdCases = COMMANDS.filter((cmd) => CMD_META[cmd]?.subcommands?.length)
    .map((cmd) => {
      const subs = CMD_META[cmd]!.subcommands!;
      return `        ${cmd})
          _values 'subcommand' ${subs.map((s) => `'${s}'`).join(" ")}
          ;;`;
    })
    .join("\n");

  const providerCases = COMMANDS.filter((cmd) => CMD_META[cmd]?.completesProviders).join("|");

  // Build _arguments spec for each command
  const cmdArgsCases = COMMANDS.map((cmd) => {
    const specs = flagSpecs(cmd);
    const lines = [`        ${cmd})`];
    if (specs) {
      lines.push(`          _arguments \\${specs}`);
    }
    lines.push("          ;;");
    return lines.join("\n");
  }).join("\n");

  return `#compdef stack
# stack completion — zsh

_stack() {
  local state
  _arguments -C \\
    '1: :->command' \\
    '*:: :->args'

  case $state in
    command)
      _values 'stack command' ${cmdDescriptions}
      ;;
    args)
      case $words[1] in
${subCmdCases}
        ${providerCases})
          _values 'provider' ${providers.map((p) => `"${p}"`).join(" ")}
          ;;
        templates)
          if [[ $CURRENT -eq 2 ]]; then
            _values 'subcommand' 'list' 'apply'
          elif [[ $words[2] == "apply" ]]; then
            _values 'template' ${templates.map((t) => `'${t}'`).join(" ")}
          fi
          ;;
        env)
          _values 'subcommand' 'show' 'diff' 'export'
          ;;
        completion)
          _values 'shell' 'bash' 'zsh' 'fish'
          ;;
${cmdArgsCases}
      esac
      ;;
  esac
}

_stack
`;
}

// ---------------------------------------------------------------------------
// fish
// ---------------------------------------------------------------------------

function emitFish(providers: string[], templates: string[]): string {
  const lines: string[] = ["# stack completion — fish", "complete -c stack -f", ""];

  // Top-level subcommands
  for (const c of COMMANDS) {
    lines.push(`complete -c stack -n "__fish_use_subcommand" -a "${c}" -d "stack ${c}"`);
  }
  lines.push("");

  // Provider completions
  for (const cmd of COMMANDS.filter((c) => CMD_META[c]?.completesProviders)) {
    for (const p of providers) {
      lines.push(
        `complete -c stack -n "__fish_seen_subcommand_from ${cmd}" -a "${p}" -d "provider"`,
      );
    }
  }
  lines.push("");

  // Subcommand completions
  for (const cmd of COMMANDS) {
    const subs = CMD_META[cmd]?.subcommands;
    if (subs) {
      for (const sub of subs) {
        lines.push(
          `complete -c stack -n "__fish_seen_subcommand_from ${cmd}" -a "${sub}" -d "${cmd} ${sub}"`,
        );
      }
    }
  }
  lines.push("");

  // templates apply <name>
  for (const t of templates) {
    lines.push(
      `complete -c stack -n "__fish_seen_subcommand_from apply" -a "${t}" -d "starter template"`,
    );
  }

  // completion shell
  for (const sh of ["bash", "zsh", "fish"]) {
    lines.push(
      `complete -c stack -n "__fish_seen_subcommand_from completion" -a "${sh}" -d "shell"`,
    );
  }
  lines.push("");

  // Flags per command
  for (const cmd of COMMANDS) {
    const flags = CMD_META[cmd]?.flags ?? [];
    for (const f of flags) {
      if (f.values) {
        for (const v of f.values) {
          lines.push(
            `complete -c stack -n "__fish_seen_subcommand_from ${cmd}" -l "${f.name}" -a "${v}" -d "${f.name} value"`,
          );
        }
      } else {
        lines.push(
          `complete -c stack -n "__fish_seen_subcommand_from ${cmd}" -l "${f.name}" -d "--${f.name}"`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
