import { type ArgsDef, type CommandDef, runCommand, runMain } from "citty";
import pc from "picocolors";

export interface RunCliIo {
  stderr: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

const defaultIo: RunCliIo = {
  stderr: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
};

/**
 * Run the CLI like citty's `runMain`, but report a failed command as one
 * line on stderr instead of a stack trace followed by the same message again.
 * Set STACK_DEBUG=1 to also print the stack. Returns the exit code and sets
 * `process.exitCode`, so callers (telemetry) still run afterwards.
 */
export async function runCli<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  rawArgs: string[],
  io: RunCliIo = defaultIo,
): Promise<number> {
  const wantsHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
  const wantsVersion = rawArgs.length === 1 && rawArgs[0] === "--version";
  if (wantsHelp || wantsVersion) {
    await runMain(cmd, { rawArgs });
    return 0;
  }
  try {
    await runCommand(cmd, { rawArgs });
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    // citty raises CLIError (not exported) while resolving the subcommand and
    // parsing its arguments, before any command body runs. runMain re-parses,
    // prints the matching usage and the error, and exits 1.
    if (error instanceof Error && error.name === "CLIError") {
      await runMain(cmd, { rawArgs });
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`  ${pc.red("✗")} ${message}`);
    if (io.env.STACK_DEBUG && error instanceof Error && error.stack) io.stderr(error.stack);
    process.exitCode = 1;
    return 1;
  }
}
