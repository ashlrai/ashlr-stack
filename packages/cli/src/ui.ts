import type { LogEvent, PromptRequest } from "@ashlr/stack-core";
import * as p from "@clack/prompts";
import pc from "picocolors";

export const colors = pc;

export function banner(): void {
  console.log();
  console.log(
    pc.bold(pc.magenta("  ▲ stack  ")) + pc.dim("— the control plane for your dev stack"),
  );
  console.log();
}

export function intro(message: string): void {
  p.intro(pc.bgMagenta(pc.white(` ${message} `)));
}

export function outro(message: string): void {
  p.outro(pc.green(message));
}

export function outroError(message: string): void {
  p.outro(pc.red(message));
  // Use exit(1) (not just exitCode) so the shell gets a real non-zero exit
  // even if something downstream (citty cleanup, a dangling handle) would
  // otherwise finish cleanly and swallow the exitCode. CI depends on this.
  process.exit(1);
}

export function logEvent(event: LogEvent): void {
  const prefix =
    event.level === "error" ? pc.red("✗") : event.level === "warn" ? pc.yellow("⚠") : pc.cyan("›");
  p.log.message(`${prefix} ${event.msg}`);
}

export const prompts = p;

/**
 * Bridge a running @clack spinner to the core pipeline's `log` + `prompt`
 * callbacks. Both pause the spinner before touching the terminal and resume it
 * after — without this, the spinner's repaint clobbers log lines and (worse)
 * the credential prompt, so `stack add` silently blocks on stdin and looks
 * hung. Pass the same `label` used in `spinner.start()` so it resumes cleanly.
 */
export function spinnerBridge(
  spinner: ReturnType<typeof p.spinner>,
  label: string,
): {
  log: (event: LogEvent) => void;
  prompt: (req: PromptRequest) => Promise<string>;
} {
  return {
    log: (event) => {
      spinner.stop();
      logEvent(event);
      spinner.start(label);
    },
    prompt: async (req) => {
      spinner.stop();
      if (req.howTo) console.log(`  ${pc.dim(req.howTo)}`);
      const value =
        req.secret === false
          ? await p.text({ message: req.message })
          : await p.password({ message: req.message });
      spinner.start(label);
      return p.isCancel(value) ? "" : value;
    },
  };
}
