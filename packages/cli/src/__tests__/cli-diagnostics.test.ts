import { afterEach, describe, expect, test } from "bun:test";
import { defineCommand } from "citty";
import { runCli } from "../lib/run-cli.ts";
import { commandPath, describeUnknownFlag } from "../lib/unknown-flags.ts";

const savedExitCode = process.exitCode ?? 0;
afterEach(() => {
  process.exitCode = savedExitCode;
});

describe("command paths for usage errors", () => {
  const leaf = defineCommand({});
  const root = defineCommand({
    subCommands: async () => ({
      env: async () => defineCommand({ subCommands: { show: leaf } }),
    }),
  });

  test.each([
    [[], "stack"],
    [["--json"], "stack"],
    [["missing"], "stack"],
    [["env"], "stack env"],
    [["env", "missing"], "stack env"],
    [["env", "show", "--json"], "stack env show"],
  ] as [string[], string][])("%j resolves to %s", async (argv, expected) => {
    expect(await commandPath(root, argv)).toBe(expected);
  });
});

describe("option diagnostics", () => {
  test("missing values take priority over typo hints", () => {
    expect(
      describeUnknownFlag({
        flag: "--platform",
        command: "stack sync",
        missingValue: true,
        suggestion: "--path",
      }),
    ).toBe(
      "Option --platform for `stack sync` requires a value. Run `stack sync --help` for usage.",
    );
  });

  test.each([
    [[], "takes no arguments"],
    [["serviceName", "projectName"], "takes <service-name> <project-name>"],
  ] as [string[], string][])("extra arguments describe %j", (extra, takes) => {
    expect(describeUnknownFlag({ flag: "extra", command: "stack add", extra })).toBe(
      `Unexpected argument "extra" for \`stack add\`, which ${takes}. Quote a value that contains spaces, or run the command once per value. Run \`stack add --help\` for usage.`,
    );
  });

  test("misplaced options explain the accepted order", () => {
    expect(describeUnknownFlag({ flag: "--json", command: "stack list", before: "list" })).toBe(
      "Option --json goes after the subcommand: run `stack list --json` (see `stack list --help`).",
    );
  });

  test.each([undefined, "--json"])("unknown options with suggestion %s", (suggestion) => {
    const hint = suggestion ? " Did you mean --json?" : "";
    expect(describeUnknownFlag({ flag: "--jsn", command: "stack list", suggestion })).toBe(
      `Unknown option --jsn for \`stack list\`.${hint} Run \`stack list --help\` for its options.`,
    );
  });
});

describe("CLI error reporting in the coverage process", () => {
  function io() {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
      env: {},
      output: stdout,
      errors: stderr,
    };
  }

  test("successful commands return normally without diagnostics", async () => {
    const capture = io();
    let ran = false;
    process.exitCode = 0;
    const cmd = defineCommand({
      run: () => {
        ran = true;
      },
    });
    expect(await runCli(cmd, [], capture)).toBe(0);
    expect(ran).toBe(true);
    expect(capture.output).toEqual([]);
    expect(capture.errors).toEqual([]);
  });

  test("non-Error failures still become a single diagnostic", async () => {
    const capture = io();
    const cmd = defineCommand({
      run: () => {
        throw "command refused";
      },
    });
    expect(await runCli(cmd, [], capture)).toBe(1);
    expect(capture.output).toEqual([]);
    expect(capture.errors).toHaveLength(1);
    expect(capture.errors[0]).toContain("command refused");
  });

  test("unknown options refuse execution and emit one parseable JSON error", async () => {
    let ran = false;
    const cmd = defineCommand({
      args: { json: { type: "boolean" } },
      run: () => {
        ran = true;
      },
    });
    const capture = io();
    expect(await runCli(cmd, ["--jsn", "--json"], capture)).toBe(1);
    expect(process.exitCode).toBe(1);
    expect(ran).toBe(false);
    expect(capture.output).toHaveLength(1);
    const { error } = JSON.parse(capture.output[0]);
    expect(error).toContain("Did you mean --json?");
    expect(capture.errors).toHaveLength(1);
    expect(capture.errors[0]).toContain(error);
  });

  test("nested missing positionals report their complete command path as JSON", async () => {
    const capture = io();
    const cmd = defineCommand({
      subCommands: {
        info: defineCommand({
          args: { service: { type: "positional", required: true }, json: { type: "boolean" } },
        }),
      },
    });
    expect(await runCli(cmd, ["info", "--json"], capture)).toBe(1);
    expect(capture.output).toHaveLength(1);
    expect(JSON.parse(capture.output[0]).error).toBe(
      "Missing required positional argument: SERVICE. Run `stack info --help` for usage.",
    );
    expect(capture.errors).toHaveLength(1);
  });

  test.each([false, true])("command errors include a stack only with debug=%s", async (debug) => {
    const capture = io();
    const error = new Error("command failed");
    const cmd = defineCommand({
      run: () => {
        throw error;
      },
    });
    expect(await runCli(cmd, [], { ...capture, env: debug ? { STACK_DEBUG: "1" } : {} })).toBe(1);
    expect(capture.output).toEqual([]);
    expect(capture.errors).toHaveLength(debug ? 2 : 1);
    expect(capture.errors[0]).toContain("command failed");
    if (debug) expect(capture.errors[1]).toBe(error.stack!);
  });
});
