import { spawn } from "node:child_process";
import { defineCommand } from "citty";
import { assertPhantomInstalled, hasConfig } from "@ashlr/stack-core";
import { colors, intro, outroError } from "../ui.ts";

/**
 * `stack exec -- <cmd>` — run a command with Phantom's proxy active so env
 * vars with `phm_` tokens get swapped for real secrets at the network layer.
 * Thin wrapper over `phantom exec` so users don't have to context-switch
 * between Stack and Phantom for day-to-day work.
 */
export const execCommand = defineCommand({
  meta: {
    name: "exec",
    description: "Run a command with Phantom's secret proxy active.",
  },
  args: {
    _: { type: "positional", required: false, description: "Command to run after --" },
  },
  async run({ rawArgs }) {
    intro("stack exec");

    if (!hasConfig()) {
      outroError("No .stack.toml found. Run `stack init` first.");
      return;
    }

    try {
      await assertPhantomInstalled();
    } catch (err) {
      outroError((err as Error).message);
      return;
    }

    // Forward everything after `--` (or everything after `exec`) to `phantom exec`.
    const sep = rawArgs.indexOf("--");
    const forwarded = sep >= 0 ? rawArgs.slice(sep + 1) : rawArgs;
    if (forwarded.length === 0) {
      outroError("Nothing to run. Usage: stack exec -- <command>");
      return;
    }

    const child = spawn("phantom", ["exec", "--", ...forwarded], { stdio: "inherit" });
    child.on("close", (code) => {
      if (code !== 0) {
        process.stderr.write(colors.dim(`\n[stack exec] phantom exec exited ${code}\n`));
      }
      process.exitCode = code ?? 0;
    });
    child.on("error", (err) => {
      outroError((err as Error).message);
    });
  },
});
