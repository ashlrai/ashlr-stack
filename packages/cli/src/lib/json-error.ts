import { EXIT_CODES } from "../exit-codes.ts";

/**
 * Typed failure payload for `--json` commands, so an agent can tell a failure
 * from a report by `schema` alone. `error` keeps its old meaning.
 */
export interface JsonError {
  schema: "ashlr.stack.error/v1";
  error: string;
}

export function jsonError(err: unknown): JsonError {
  return {
    schema: "ashlr.stack.error/v1",
    error: err instanceof Error ? err.message : String(err),
  };
}

/** Print the error payload on stdout and exit 1. */
export function exitWithJsonError(err: unknown): never {
  process.stdout.write(`${JSON.stringify(jsonError(err))}\n`);
  process.exit(EXIT_CODES.ERROR);
}
