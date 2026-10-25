import { spawn } from "node:child_process";
import { constants } from "node:os";
import { assertPhantomInstalled, hasConfig } from "@ashlr/stack-core";
import { defineCommand } from "citty";
import { runAgentPreflight } from "../lib/agent-preflight.ts";
import { expectRefusal, parseExecArgv, readPinnedAlias } from "../lib/locus-identity.ts";
import { colors } from "../ui.ts";

/**
 * stdout belongs to the wrapped command (`stack exec -- cmd > out.json`), so
 * every message from stack itself goes to stderr.
 */
function fail(message: string): void {
  process.stderr.write(`${colors.red(`[stack exec] ${message}`)}\n`);
  process.exit(1);
}

const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

/**
 * Signals a terminal sends to the whole foreground process group (Ctrl-C,
 * hangup; on Windows the console sends Ctrl-C to every attached process).
 * The wrapped command shares that group, so it already has the signal.
 */
const TERMINAL_SIGNALS: ReadonlySet<NodeJS.Signals> = new Set(["SIGINT", "SIGHUP"]);

/**
 * Whether `stack exec` should relay `signal` to the wrapped command. On a
 * terminal, Ctrl-C already reached the command; relaying it would deliver a
 * second SIGINT, which many tools read as "force quit now" (terraform's "Two
 * interrupts received. Exiting immediately."). Off a terminal (an agent or
 * supervisor signalling this pid) every forwarded signal is relayed.
 */
export function shouldRelaySignal(signal: NodeJS.Signals, onTerminal: boolean): boolean {
  return !(onTerminal && TERMINAL_SIGNALS.has(signal));
}

/**
 * Exit status for the wrapped command. A signal-terminated child has a null
 * exit code; map it to the shell convention 128 + signal number so callers
 * never read a killed command as success.
 */
export function exitCodeFor(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  if (signal) return 128 + (constants.signals[signal] ?? 0);
  return 1;
}

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
    as: {
      type: "string",
      description:
        "Refuse (exit 1, nothing starts) unless this Locus binding alias is pinned (needs `--`)",
      valueHint: "alias",
    },
    _: { type: "positional", required: false, description: "Command to run after --" },
  },
  async run({ rawArgs }) {
    // Usage first: bare `stack exec` used to answer with the Phantom install
    // hint (or "run stack init") instead of saying a command was missing.
    // Forward everything after `--` (or everything after `exec`) to `phantom exec`.
    const parsed = parseExecArgv(rawArgs);
    if (!parsed.ok) {
      fail(parsed.message);
      return;
    }
    const forwarded = parsed.forwarded;
    if (forwarded.length === 0) {
      fail("Nothing to run. Usage: stack exec -- <command>");
      return;
    }

    if (!hasConfig()) {
      fail("No .stack.toml found. Run `stack init` first.");
      return;
    }

    // `--as`: the identity check runs before Phantom or the command starts.
    if (parsed.as !== undefined) {
      const refusal = expectRefusal(parsed.as, readPinnedAlias());
      if (refusal) {
        fail(refusal);
        return;
      }
    }

    try {
      await assertPhantomInstalled();
    } catch (err) {
      fail((err as Error).message);
      return;
    }

    // Opt-in (STACK_PHANTOM_PREFLIGHT=1 or strict): Phantom's value-free agent
    // preflight. Off by default; a phantom without it only warns.
    const preflight = runAgentPreflight();
    if (preflight.message)
      process.stderr.write(`${colors.dim(`[stack exec] ${preflight.message}`)}\n`);
    if (preflight.refuse) {
      process.exitCode = 1;
      return;
    }

    const child = spawn("phantom", ["exec", "--", ...forwarded], { stdio: "inherit" });

    // A TERM/HUP/INT sent to `stack exec` alone (an agent's timeout, a
    // supervisor) would otherwise kill only this wrapper and leave the
    // wrapped command running. Forward it and wait for the child to exit.
    // On a terminal, Ctrl-C/hangup already reached the command (same process
    // group), so stack only keeps waiting for it instead of sending a second one.
    const onTerminal = [process.stdin, process.stdout, process.stderr].some(
      (stream) => stream.isTTY === true,
    );
    const forward = (signal: NodeJS.Signals) => () => {
      if (!shouldRelaySignal(signal, onTerminal)) return;
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    };
    const handlers = FORWARDED_SIGNALS.map((signal) => {
      const handler = forward(signal);
      process.on(signal, handler);
      return [signal, handler] as const;
    });

    child.on("close", (code, signal) => {
      for (const [sig, handler] of handlers) process.off(sig, handler);
      const exitCode = exitCodeFor(code, signal);
      if (exitCode !== 0) {
        const how = signal ? `was killed by ${signal}` : `exited ${code}`;
        process.stderr.write(colors.dim(`\n[stack exec] phantom exec ${how}\n`));
      }
      process.exitCode = exitCode;
    });
    child.on("error", (err) => {
      fail((err as Error).message);
    });
  },
});
