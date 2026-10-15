import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { hasConfig } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { intro, outroError } from "../ui.ts";

/**
 * Retain the existing command and owner guards, but do not emit an unattended
 * Cloud-pull workflow: Phantom Cloud requires trusted-terminal approval.
 */
export const ciCommand = defineCommand({
  meta: {
    name: "ci",
    description: "Inspect CI health workflow availability.",
  },
  subCommands: {
    init: defineCommand({
      meta: {
        name: "init",
        description: "CI health workflow generation is currently unavailable.",
      },
      args: {
        force: {
          type: "boolean",
          default: false,
          description:
            "Compatibility flag; generation is unavailable and no workflow is overwritten.",
        },
      },
      async run({ args }) {
        intro("stack ci init");
        if (!hasConfig()) {
          outroError("No .stack.toml found. Run `stack init` first.");
          return;
        }
        const cwd = process.cwd();
        const dir = resolve(join(cwd, ".github", "workflows"));
        const path = join(dir, "stack-ci.yml");
        if (existsSync(path) && !args.force) {
          outroError(`${path} already exists. It was not changed.`);
          return;
        }
        outroError(
          "CI health workflow unavailable: Phantom Cloud pull requires trusted-terminal approval. No workflow was written.",
        );
      },
    }),
  },
});
