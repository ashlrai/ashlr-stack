import { type ArgsDef, type CommandDef, runCommand, runMain } from "citty";
import pc from "picocolors";
import { normalizeKebabFlags } from "./normalize-args.ts";
import { checkFlags } from "./unknown-flags.ts";

export interface RunCliIo {
  stderr: (line: string) => void;
  stdout: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

const defaultIo: RunCliIo = {
  stderr: (line) => process.stderr.write(`${line}\n`),
  stdout: (line) => process.stdout.write(`${line}\n`),
  env: process.env,
};

/**
 * Run the CLI like citty's `runMain`, but report a failed command as one
 * line on stderr instead of a stack trace followed by the same message again.
 * Set STACK_DEBUG=1 to also print the stack. Returns the exit code and sets
 * `process.exitCode`, so callers (telemetry) still run afterwards.
 *
 * `argv` is the raw argv after `stack`. An undeclared flag is a usage error
 * (exit 1, like citty's own usage errors): one stderr line naming it and the
 * closest declared flag, or `{"error": ...}` on stdout when the command was
 * asked for `--json`. See lib/unknown-flags.ts. Kebab-case flags are then
 * normalized (lib/normalize-args.ts) before citty parses them.
 */
export async function runCli<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  argv: string[],
  io: RunCliIo = defaultIo,
): Promise<number> {
  // Tokens after a bare `--` belong to a wrapped command (`stack exec -- ls -h`).
  const sep = argv.indexOf("--");
  const own = sep >= 0 ? argv.slice(0, sep) : argv;
  const wantsHelp = own.includes("--help") || own.includes("-h");
  const wantsVersion = argv.length === 1 && argv[0] === "--version";
  if (wantsHelp || wantsVersion) {
    const rawArgs = normalizeKebabFlags(argv);
    await runMain(cmd, { rawArgs });
    return 0;
  }
  const check = await checkFlags(cmd, argv);
  if (!check.ok) {
    if (check.error.json) io.stdout(JSON.stringify({ error: check.error.message }));
    else io.stderr(check.error.message);
    process.exitCode = 1;
    return 1;
  }
  const rawArgs = normalizeKebabFlags(check.args);
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
