import type { SubCommandsDef } from "citty";

// citty resolves command loaders only along the selected command path.
export const commandLoaders = {
  init: () => import("./commands/init.ts").then((m) => m.initCommand),
  import: () => import("./commands/import.ts").then((m) => m.importCommand),
  scan: () => import("./commands/scan.ts").then((m) => m.scanCommand),
  clone: () => import("./commands/clone.ts").then((m) => m.cloneCommand),
  add: () => import("./commands/add.ts").then((m) => m.addCommand),
  remove: () => import("./commands/remove.ts").then((m) => m.removeCommand),
  list: () => import("./commands/list.ts").then((m) => m.listCommand),
  info: () => import("./commands/info.ts").then((m) => m.infoCommand),
  status: () => import("./commands/status.ts").then((m) => m.statusCommand),
  env: () => import("./commands/env.ts").then((m) => m.envCommand),
  deps: () => import("./commands/deps.ts").then((m) => m.depsCommand),
  doctor: () => import("./commands/doctor.ts").then((m) => m.doctorCommand),
  exec: () => import("./commands/exec.ts").then((m) => m.execCommand),
  swap: () => import("./commands/swap.ts").then((m) => m.swapCommand),
  sync: () => import("./commands/sync.ts").then((m) => m.syncCommand),
  onboard: () => import("./commands/onboard.ts").then((m) => m.onboardCommand),
  open: () => import("./commands/open.ts").then((m) => m.openCommand),
  login: () => import("./commands/login.ts").then((m) => m.loginCommand),
  telemetry: () => import("./commands/telemetry.ts").then((m) => m.telemetryCommand),
  templates: () => import("./commands/templates.ts").then((m) => m.templatesCommand),
  providers: () => import("./commands/providers.ts").then((m) => m.providersCommand),
  recommend: () => import("./commands/recommend.ts").then((m) => m.recommendCommand),
  apply: () => import("./commands/apply.ts").then((m) => m.applyCommand),
  projects: () => import("./commands/projects.ts").then((m) => m.projectsCommand),
  ci: () => import("./commands/ci.ts").then((m) => m.ciCommand),
  completion: () => import("./commands/completion.ts").then((m) => m.completionCommand),
  upgrade: () => import("./commands/upgrade.ts").then((m) => m.upgradeCommand),
} satisfies SubCommandsDef;

// Root help needs only these descriptions; loading implementations here would
// make citty import every command while rendering the command list.
export const commandDescriptions = {
  init: "Scaffold a .stack.toml in the current directory.",
  import: "Import an existing .env into Phantom + .stack.toml.",
  scan: "Detect providers used by this repo (package.json, config files, .env.example).",
  clone: "Clone a GitHub repo and auto-detect its Stack services.",
  add: "Provision a service and wire its secrets + MCP entry.",
  remove:
    "Remove local service config and MCP wiring; attempt Phantom secret removal (headless runs may retain secrets).",
  list: "List services configured in this stack.",
  info: "Show everything Stack knows about a configured service.",
  status: "Show stack health at a glance.",
  env: "Inspect the effective env-var map for this stack.",
  deps: "Show the service dependency graph for this stack.",
  doctor: "Verify every service is reachable and credentials are valid.",
  exec: "Run a command with Phantom's secret proxy active.",
  swap: "Migrate a project from one provider to an equivalent in the same category.",
  sync: "Push secrets to a deployment platform (via phantom sync).",
  onboard:
    "Detect Codex, Claude Code, Cursor and Gemini CLI and register the Phantom gateway in each (plan by default).",
  open: "Open a service's dashboard in your browser.",
  login: "Refresh OAuth / PAT credentials for a specific provider.",
  telemetry: "Opt into / out of anonymous usage telemetry. See docs/PRIVACY.md.",
  templates: "List or apply starter stack templates.",
  providers: "List every curated provider Stack can wire up.",
  recommend: "Pick the right providers for what you're building (AI-assisted).",
  apply:
    "Apply a saved recipe: provision each provider, check its secrets in Phantom, and add webhook stubs.",
  projects: "Manage the cross-project registry at ~/.stack/projects.json.",
  ci: "CI workflow generation (unavailable; use `stack doctor` instead).",
  completion: "Emit shell completion for bash, zsh, or fish.",
  upgrade: "Check for a release or safely upgrade an npm global CLI install.",
} satisfies Record<keyof typeof commandLoaders, string>;
