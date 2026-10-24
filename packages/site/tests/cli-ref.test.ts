import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { CLI_COMMANDS } from "../src/lib/cli-ref.generated";

const CLI_ENTRY = join(import.meta.dir, "..", "..", "cli", "src", "index.ts");

/** Top-level command names from `stack --help`'s USAGE line (citty's subCommands, in order). */
function cliSubCommands(): string[] {
  // citty prints help through consola, which drops `log` output when
  // NODE_ENV=test (as under `bun test`), so run the CLI as a user would.
  const { TEST: _test, ...env } = process.env;
  const result = spawnSync(process.execPath, [CLI_ENTRY, "--help"], {
    encoding: "utf8",
    env: { ...env, NODE_ENV: "production", NO_COLOR: "1", CI: "1", STACK_TELEMETRY: "0" },
  });
  const usage = `${result.stdout}${result.stderr}`.match(/USAGE `?stack \[OPTIONS\] ([\w|-]+)/);
  if (!usage) throw new Error(`no USAGE line in stack --help:\n${result.stdout}${result.stderr}`);
  return usage[1].split("|");
}

describe("site CLI reference", () => {
  test("documents exactly the CLI's top-level commands, in --help order", () => {
    const cli = cliSubCommands();
    expect(cli.length).toBeGreaterThan(0);
    expect(CLI_COMMANDS.map((c) => c.name.replace(/^stack /, ""))).toEqual(cli);
  });
});
