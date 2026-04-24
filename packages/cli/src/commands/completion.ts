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
 */
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
    const commands = [
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
      "projects",
      "upgrade",
      "completion",
      "ci",
    ];
    const providers = listProviderNames();
    const templates = listTemplates();

    if (shell === "bash") process.stdout.write(emitBash(commands, providers, templates));
    else if (shell === "zsh") process.stdout.write(emitZsh(commands, providers, templates));
    else if (shell === "fish") process.stdout.write(emitFish(commands, providers, templates));
    else {
      process.stderr.write(`Unsupported shell: ${shell}. Use bash, zsh, or fish.\n`);
      process.exit(1);
    }
  },
});

function emitBash(commands: string[], providers: string[], templates: string[]): string {
  return `# stack completion — bash
_stack_completion() {
  local cur prev words cword
  _init_completion || return

  if [[ \${cword} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${commands.join(" ")}" -- "\${cur}") )
    return
  fi

  case "\${words[1]}" in
    add|remove|info|login|open)
      COMPREPLY=( $(compgen -W "${providers.join(" ")}" -- "\${cur}") )
      ;;
    templates)
      if [[ \${cword} -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "list apply" -- "\${cur}") )
      elif [[ "\${words[2]}" == "apply" ]]; then
        COMPREPLY=( $(compgen -W "${templates.join(" ")}" -- "\${cur}") )
      fi
      ;;
    sync)
      COMPREPLY=( $(compgen -W "--platform vercel railway fly" -- "\${cur}") )
      ;;
    env)
      COMPREPLY=( $(compgen -W "show diff set unset" -- "\${cur}") )
      ;;
    projects)
      COMPREPLY=( $(compgen -W "list register remove where" -- "\${cur}") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "\${cur}") )
      ;;
  esac
}
complete -F _stack_completion stack
`;
}

function emitZsh(commands: string[], providers: string[], templates: string[]): string {
  return `#compdef stack
# stack completion — zsh

_stack() {
  local state
  _arguments -C \\
    '1: :->command' \\
    '*:: :->args'

  case \$state in
    command)
      _values 'stack command' ${commands.map((c) => `"${c}"`).join(" ")}
      ;;
    args)
      case \$words[1] in
        add|remove|info|login|open)
          _values 'provider' ${providers.map((p) => `"${p}"`).join(" ")}
          ;;
        templates)
          if [[ $CURRENT -eq 2 ]]; then
            _values 'subcommand' 'list' 'apply'
          elif [[ $words[2] == "apply" ]]; then
            _values 'template' ${templates.map((t) => `"${t}"`).join(" ")}
          fi
          ;;
        env)
          _values 'subcommand' 'show' 'diff' 'set' 'unset'
          ;;
        projects)
          _values 'subcommand' 'list' 'register' 'remove' 'where'
          ;;
        completion)
          _values 'shell' 'bash' 'zsh' 'fish'
          ;;
      esac
      ;;
  esac
}

_stack
`;
}

function emitFish(commands: string[], providers: string[], templates: string[]): string {
  const lines: string[] = ["# stack completion — fish", "complete -c stack -f", ""];
  for (const c of commands) {
    lines.push(`complete -c stack -n "__fish_use_subcommand" -a "${c}" -d "stack subcommand"`);
  }
  for (const verb of ["add", "remove", "info", "login", "open"]) {
    for (const p of providers) {
      lines.push(
        `complete -c stack -n "__fish_seen_subcommand_from ${verb}" -a "${p}" -d "provider"`,
      );
    }
  }
  for (const sub of ["list", "apply"]) {
    lines.push(
      `complete -c stack -n "__fish_seen_subcommand_from templates" -a "${sub}" -d "template action"`,
    );
  }
  for (const t of templates) {
    lines.push(
      `complete -c stack -n "__fish_seen_subcommand_from apply" -a "${t}" -d "starter template"`,
    );
  }
  for (const sub of ["show", "diff", "set", "unset"]) {
    lines.push(
      `complete -c stack -n "__fish_seen_subcommand_from env" -a "${sub}" -d "env subcommand"`,
    );
  }
  for (const sh of ["bash", "zsh", "fish"]) {
    lines.push(
      `complete -c stack -n "__fish_seen_subcommand_from completion" -a "${sh}" -d "shell"`,
    );
  }
  return `${lines.join("\n")}\n`;
}
