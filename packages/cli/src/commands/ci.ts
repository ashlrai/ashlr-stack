import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { hasConfig } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { intro, outroError } from "../ui.ts";

/**
 * Workflow generation is intentionally unavailable: the former workflow ran
 * `phantom cloud pull` unattended, and Phantom Cloud pull requires
 * trusted-terminal approval. Every path through `stack ci` refuses with one
 * actionable line and exit 1, and never writes a workflow.
 */
export const CI_UNAVAILABLE =
  "CI health workflow unavailable: Phantom Cloud pull requires trusted-terminal approval. No workflow was written. Instead, run `stack doctor` from a trusted terminal, or `stack doctor --reconcile --json` in CI for a credential-free source-drift report.";

const jsonArg = {
  type: "boolean",
  default: false,
  description: "Emit the refusal as JSON ({ error }) on stdout.",
} as const;

function refuse(message: string, json: boolean, title: string): void {
  if (json) {
    process.stdout.write(`${JSON.stringify({ error: message })}\n`);
    process.exit(1);
  }
  intro(title);
  outroError(message);
}

const initCommand = defineCommand({
  meta: {
    name: "init",
    description:
      "Unavailable: refuses with what to run instead (stack doctor). Never writes a workflow.",
  },
  args: {
    force: {
      type: "boolean",
      default: false,
      description: "Compatibility flag; generation is unavailable and no workflow is overwritten.",
    },
    json: jsonArg,
  },
  async run({ args }) {
    const json = args.json === true;
    if (!hasConfig()) {
      refuse("No .stack.toml found. Run `stack init` first.", json, "stack ci init");
      return;
    }
    const path = join(resolve(join(process.cwd(), ".github", "workflows")), "stack-ci.yml");
    if (existsSync(path) && !args.force) {
      refuse(`${path} already exists. It was not changed.`, json, "stack ci init");
      return;
    }
    refuse(CI_UNAVAILABLE, json, "stack ci init");
  },
});

export const ciCommand = defineCommand({
  meta: {
    name: "ci",
    description: "CI workflow generation (unavailable; use `stack doctor` instead).",
  },
  args: {
    json: jsonArg,
  },
  subCommands: {
    init: initCommand,
  },
  async run({ args, rawArgs }) {
    // citty runs the parent after a matched subcommand; only handle bare `stack ci`.
    if (rawArgs.some((a) => !a.startsWith("-"))) return;
    refuse(CI_UNAVAILABLE, args.json === true, "stack ci");
  },
});
