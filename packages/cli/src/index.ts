#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { addCommand } from "./commands/add.ts";
import { applyCommand } from "./commands/apply.ts";
import { ciCommand } from "./commands/ci.ts";
import { cloneCommand } from "./commands/clone.ts";
import { completionCommand } from "./commands/completion.ts";
import { depsCommand } from "./commands/deps.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { envCommand } from "./commands/env.ts";
import { execCommand } from "./commands/exec.ts";
import { importCommand } from "./commands/import.ts";
import { infoCommand } from "./commands/info.ts";
import { initCommand } from "./commands/init.ts";
import { listCommand } from "./commands/list.ts";
import { loginCommand } from "./commands/login.ts";
import { openCommand } from "./commands/open.ts";
import { recommendCommand } from "./commands/recommend.ts";
import { projectsCommand } from "./commands/projects.ts";
import { providersCommand } from "./commands/providers.ts";
import { removeCommand } from "./commands/remove.ts";
import { scanCommand } from "./commands/scan.ts";
import { statusCommand } from "./commands/status.ts";
import { syncCommand } from "./commands/sync.ts";
import { templatesCommand } from "./commands/templates.ts";
import { upgradeCommand } from "./commands/upgrade.ts";

// Single source of truth for the CLI version. citty wires this into `--help`
// and we also use it for `stack --version` (citty ships a standalone flag when
// `version` is on the meta object — but older citty needs a fallback, below).
const VERSION = "0.1.0";

const main = defineCommand({
  meta: {
    name: "stack",
    version: VERSION,
    description:
      "Ashlr Stack — provision, wire, and operate every third-party service in your project.",
  },
  args: {
    version: {
      type: "boolean",
      alias: "v",
      description: "Print the CLI version and exit.",
    },
  },
  run({ args }) {
    if (args.version) {
      console.log(VERSION);
      return;
    }
    // citty 0.1.6 calls the root `run` even when a subcommand matched. Detect
    // that case by checking process.argv — if the first non-bun arg is a known
    // subcommand, the subcommand already handled the request and we should
    // stay silent (otherwise every `stack <sub>` trails a banner and breaks
    // machine-readable output like `stack recommend --json`).
    const firstArg = process.argv[2];
    if (firstArg && !firstArg.startsWith("-")) return;
    console.log(`\n  ▲ stack ${VERSION}`);
    console.log("  The control plane for your entire dev stack.");
    console.log("  Run `stack --help` for the full command list.\n");
  },
  subCommands: {
    init: initCommand,
    import: importCommand,
    scan: scanCommand,
    clone: cloneCommand,
    add: addCommand,
    remove: removeCommand,
    list: listCommand,
    info: infoCommand,
    status: statusCommand,
    env: envCommand,
    deps: depsCommand,
    doctor: doctorCommand,
    exec: execCommand,
    sync: syncCommand,
    open: openCommand,
    login: loginCommand,
    templates: templatesCommand,
    providers: providersCommand,
    recommend: recommendCommand,
    apply: applyCommand,
    projects: projectsCommand,
    ci: ciCommand,
    completion: completionCommand,
    upgrade: upgradeCommand,
  },
});

runMain(main);
