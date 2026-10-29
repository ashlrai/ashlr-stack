import { defineCommand } from "citty";
import { commandDescriptions, commandLoaders } from "./commands.ts";
import { normalizeKebabFlags } from "./lib/normalize-args.ts";
import { runCli } from "./lib/run-cli.ts";
import { printVersion } from "./lib/version.ts";

export async function run(argv: string[], version: string, helpOnly = false): Promise<void> {
  const main = defineCommand({
    meta: {
      name: "stack",
      version,
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
        printVersion(version, process.argv.includes("--json"));
        return;
      }
      // citty 0.1.6 calls the root `run` even when a subcommand matched. Detect
      // that case by checking process.argv — if the first non-bun arg is a known
      // subcommand, the subcommand already handled the request and we should
      // stay silent (otherwise every `stack <sub>` trails a banner and breaks
      // machine-readable output like `stack recommend --json`).
      const firstArg = process.argv[2];
      if (firstArg && !firstArg.startsWith("-")) return;
      console.log(`\n  ▲ stack ${version}`);
      console.log("  The control plane for your entire dev stack.");
      console.log("  Run `stack --help` for the full command list.\n");
    },
    subCommands: helpOnly
      ? Object.fromEntries(
          Object.entries(commandDescriptions).map(([name, description]) => [
            name,
            { meta: { name, description } },
          ]),
        )
      : commandLoaders,
  });

  const startMs = Date.now();
  if (!helpOnly) {
    const { checkForUpdate } = await import("./lib/update-check.ts");
    void checkForUpdate(version);
  }
  // Keep normalization and unknown-option validation on every execution path.
  await runCli(main, normalizeKebabFlags(argv));
  if (!helpOnly && process.env.STACK_TELEMETRY !== "0") {
    const { emitTelemetry } = await import("./lib/telemetry.ts");
    void emitTelemetry({
      type: "command",
      command: argv[0] ?? "unknown",
      exitCode: typeof process.exitCode === "number" ? process.exitCode : 0,
      durationMs: Date.now() - startMs,
    });
  }
}
