import type { LogEvent } from "@ashlr/stack-core";
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
