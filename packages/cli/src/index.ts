#!/usr/bin/env bun
import { emitTelemetry } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { buildHandshake } from "./lib/handshake.ts";
import { normalizeKebabFlags } from "./lib/normalize-args.ts";
import { runCli } from "./lib/run-cli.ts";
import { installSynchronousStdio } from "./lib/sync-stdout.ts";
import { checkForUpdate } from "./lib/update-check.ts";

// Single source of truth for the CLI version. citty wires this into `--help`
// and we also use it for `stack --version` (citty ships a standalone flag when
// `version` is on the meta object — but older citty needs a fallback, below).
const VERSION = "0.2.2";

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
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON (used with --version).",
    },
    ashlrHandshake: {
      type: "boolean",
      description: "Print the Ashlr companion handshake (JSON) and exit.",
    },
  },
  run({ args }) {
    if (args.version) {
      const platform = `${process.platform}-${process.arch}`;
      const node = process.versions.node ? `v${process.versions.node}` : undefined;
      const bun =
        typeof (globalThis as Record<string, unknown>).Bun !== "undefined"
          ? (globalThis as { Bun?: { version?: string } }).Bun?.version
          : undefined;

      if (process.argv.includes("--json")) {
        const obj: Record<string, string> = { version: VERSION, platform };
        if (bun !== undefined) obj.bun = bun;
        if (node !== undefined) obj.node = node;
        console.log(JSON.stringify(obj));
      } else {
        console.log(`stack ${VERSION}`);
        console.log(`platform: ${platform}`);
        if (bun !== undefined) console.log(`bun: ${bun}`);
        if (node !== undefined) console.log(`node: ${node}`);
      }
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
  // Resolve only the selected command. Root version output must not load commands.
  subCommands: {
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
    "fleet-lanes": () => import("./commands/fleet-lanes.ts").then((m) => m.fleetLanesCommand),
    "fleet-supply": () => import("./commands/fleet-supply.ts").then((m) => m.fleetSupplyCommand),
    "fleet-latency": () => import("./commands/fleet-latency.ts").then((m) => m.fleetLatencyCommand),
    "fleet-lag": () => import("./commands/fleet-lag.ts").then((m) => m.fleetLagCommand),
    "fleet-reds": () => import("./commands/fleet-reds.ts").then((m) => m.fleetRedsCommand),
    "fleet-delivery-lag": () =>
      import("./commands/fleet-delivery-lag.ts").then((m) => m.fleetDeliveryLagCommand),
    "fleet-stuck": () => import("./commands/fleet-stuck.ts").then((m) => m.fleetStuckCommand),
    "fleet-slo": () => import("./commands/fleet-slo.ts").then((m) => m.fleetSloCommand),
    "fleet-act": () => import("./commands/fleet-act.ts").then((m) => m.fleetActCommand),
    "fleet-stream": () => import("./commands/fleet-stream.ts").then((m) => m.fleetStreamCommand),
    "fleet-graph": () => import("./commands/fleet-graph.ts").then((m) => m.fleetGraphCommand),
    "fleet-bets": () => import("./commands/fleet-bets.ts").then((m) => m.fleetBetsCommand),
    fleet: () => import("./commands/fleet.ts").then((m) => m.fleetCommand),
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
  },
});

// The companion handshake answers before the update check and telemetry:
// it must stay local and fast (docs/ashlr-handshake.md).
if (process.argv.slice(2).includes("--ashlr-handshake")) {
  process.stdout.write(`${JSON.stringify(buildHandshake(VERSION))}\n`);
  process.exit(0);
}

// Before any output: outroError exits the process, and Bun 1.2 drops queued
// stdout writes on exit unless they were written synchronously.
installSynchronousStdio();
const _startMs = Date.now();
void checkForUpdate(VERSION);
// Normalize kebab-case flags (`--dry-run`) to the camelCase keys our commands
// declare (`dryRun`) before citty parses them — see lib/normalize-args.ts.
runCli(main, normalizeKebabFlags(process.argv.slice(2))).finally(() => {
  void emitTelemetry({
    type: "command",
    command: process.argv[2] ?? "unknown",
    exitCode: typeof process.exitCode === "number" ? process.exitCode : 0,
    durationMs: Date.now() - _startMs,
  });
});
