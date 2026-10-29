import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type CommandDef, defineCommand } from "citty";
import { TOOLS } from "../../../mcp/src/tools.ts";
import { addCommand } from "../commands/add.ts";
import { envCommand } from "../commands/env.ts";
import { execCommand } from "../commands/exec.ts";
import { initCommand } from "../commands/init.ts";
import { recommendCommand } from "../commands/recommend.ts";
import { syncCommand } from "../commands/sync.ts";
import { templatesCommand } from "../commands/templates.ts";
import { upgradeCommand } from "../commands/upgrade.ts";
import { normalizeKebabFlags } from "../lib/normalize-args.ts";
import { findUnknownFlag } from "../lib/unknown-flags.ts";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function stack(args: string[]) {
  const cwd = mkdtempSync(join(tmpdir(), "stack-unknown-flags-"));
  created.push(cwd);
  const r = spawnSync("bun", [CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      NO_COLOR: "1",
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
    },
    timeout: 20_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("unknown options are refused", () => {
  test("a value-taking option without a value fails before the command runs", () => {
    const r = stack(["sync", "--platform"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Option --platform for `stack sync` requires a value");
    expect(r.stderr).toContain("stack sync --help");
  });

  test("a following option is not consumed as the missing value", () => {
    const r = stack(["env", "--env", "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).error).toContain("Option --env for `stack env` requires a value");
    expect(r.stderr).toContain("requires a value");
  });

  test("an unknown option with an attached value exits unsuccessfully and names the option", () => {
    const r = stack(["templates", "list", "--bogus=value"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Unknown option --bogus for `stack templates list`");
  });

  test("a typo exits 1, names the option and the closest real one", () => {
    const r = stack(["templates", "list", "--jsn"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Unknown option --jsn for `stack templates list`");
    expect(r.stderr).toContain("Did you mean --json?");
    expect(r.stderr).toContain("Run `stack templates list --help`");
  });

  test("an option the command lacks is an error, as JSON on stdout when --json was asked for", () => {
    // `stack sync` has no --json; it used to print its human banner instead.
    const r = stack(["sync", "--platform", "vercel", "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).error).toContain("Unknown option --json for `stack sync`");
  });

  test("an option before the subcommand is refused and moved after it", () => {
    // `stack --json list` passed the guard (the root declares --json for
    // --version) and list never saw it: human output, exit 1 or 0.
    const r = stack(["--json", "list"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).error).toContain(
      "Option --json goes after the subcommand: run `stack list --json`",
    );
    const v = stack(["-v", "list"]);
    expect(v.code).toBe(1);
    expect(v.stderr).toContain("Unknown option -v for `stack list`");
  });

  test("an unknown root option is refused instead of printing the banner", () => {
    const r = stack(["--bogus"]);
    expect(r.code).toBe(1);
    expect(r.stdout).not.toContain("The control plane");
    expect(r.stderr).toContain("Unknown option --bogus for `stack`");
  });
});

const main = defineCommand({
  meta: { name: "stack" },
  args: { version: { type: "boolean", alias: "v" }, json: { type: "boolean" } },
  subCommands: {
    add: addCommand,
    env: envCommand,
    exec: execCommand,
    init: initCommand,
    recommend: recommendCommand,
    sync: syncCommand,
    templates: templatesCommand,
    upgrade: upgradeCommand,
  },
}) as CommandDef;

const unknown = (argv: string[]) => findUnknownFlag(main, normalizeKebabFlags(argv));

describe("extra positional arguments are refused", () => {
  test("an unquoted multi-word query is refused instead of searching for its first word", () => {
    // citty kept "build" and dropped "a saas", then searched for "build" alone.
    const r = stack(["recommend", "build", "a", "saas", "--json"]);
    expect(r.code).toBe(1);
    const { error } = JSON.parse(r.stdout);
    expect(error).toContain('Unexpected argument "a" for `stack recommend`, which takes <query>');
    expect(error).toContain("Quote a value that contains spaces");
  });

  test("a second service and an argument to a command that takes none are named", async () => {
    expect(await unknown(["add", "supabase", "neon"])).toMatchObject({
      flag: "neon",
      command: "stack add",
      extra: ["service"],
    });
    expect(await unknown(["templates", "list", "x"])).toMatchObject({
      flag: "x",
      command: "stack templates list",
      extra: [],
    });
  });

  test("option values are not counted as positionals", async () => {
    expect(await unknown(["add", "openai", "--region", "us-east-1"])).toBeNull();
    expect(await unknown(["recommend", "--k", "3", "db"])).toBeNull();
    expect(await unknown(["recommend", "db", "--k", "3", "extra"])).toMatchObject({
      flag: "extra",
    });
  });
});

describe("findUnknownFlag accepts every declared spelling", () => {
  test("recognizes missing short-option values and the end-of-options marker", async () => {
    const cmd = defineCommand({ args: { output: { type: "string", alias: "o" } } });
    expect(await findUnknownFlag(cmd, ["-o"])).toMatchObject({ flag: "-o", missingValue: true });
    expect(await findUnknownFlag(cmd, ["--output", "--"])).toMatchObject({
      flag: "--output",
      missingValue: true,
    });
    expect(await findUnknownFlag(cmd, ["-o", "-1"])).toBeNull();
    expect(await findUnknownFlag(cmd, ["--output=-file"])).toBeNull();
  });

  test.each([
    [["add", "openai", "--dry-run", "--use=res_1", "--region", "us-east-1"]],
    [["add", "openai", "--dryRun", "--install=never"]],
    [["templates", "apply", "x", "--no-continue-on-error"]],
    [["templates", "--json"]],
    [["env", "--json"]],
    [["env", "export", "--stdout", "--force"]],
    [["recommend", "db", "--k", "-1"]],
    [["upgrade", "-n"]],
    [["init", "--help"]],
    [["-v", "--json"]],
    [["exec", "--", "ls", "--weird"]],
    [["exec", "node", "--inspect", "x.js"]],
  ])("%j", async (argv) => {
    expect(await unknown(argv)).toBeNull();
  });

  test("reports the subcommand path and options before the subcommand", async () => {
    expect(await unknown(["templates", "apply", "x", "--continue"])).toMatchObject({
      flag: "--continue",
      command: "stack templates apply",
    });
    expect(await unknown(["--jsn", "templates"])).toMatchObject({
      flag: "--jsn",
      command: "stack",
    });
    expect(await unknown(["upgrade", "-x"])).toMatchObject({ flag: "-x" });
    expect(await unknown(["env", "--json", "show"])).toMatchObject({
      flag: "--json",
      command: "stack env show",
      before: "show",
    });
    expect(await unknown(["--json", "sync", "--platform", "vercel"])).toMatchObject({
      flag: "--json",
      command: "stack sync",
      before: undefined,
    });
  });

  test("every argv the MCP server builds passes the guard", async () => {
    const { subCommands: _ignored, ...rootRest } = main;
    const full = defineCommand({
      ...rootRest,
      subCommands: Object.fromEntries(
        await Promise.all(
          [
            "add",
            "apply",
            "deps",
            "doctor",
            "env",
            "import",
            "info",
            "init",
            "list",
            "projects",
            "providers",
            "recommend",
            "remove",
            "scan",
            "status",
            "sync",
            "templates",
            "upgrade",
          ].map(async (name) => {
            const mod = (await import(`../commands/${name}.ts`)) as Record<string, unknown>;
            return [name, mod[`${name}Command`] as CommandDef];
          }),
        ),
      ),
    }) as CommandDef;
    const everything: Record<string, unknown> = {
      template: "t",
      force: true,
      from: ".env",
      dryRun: true,
      path: ".",
      confidence: "high",
      service: "openai",
      use: "res",
      keepRemote: true,
      json: true,
      fix: true,
      all: true,
      platform: "vercel",
      query: "db",
      k: 3,
      category: "Database",
      save: true,
      recipe_id: "r",
      no_wire: true,
      // Never reaches the argv: the MCP server runs `stack` in this directory.
      cwd: "/tmp",
    };
    for (const tool of TOOLS) {
      // A new MCP argument needs a sample value here, so its flag is checked too.
      for (const key of Object.keys(tool.inputSchema.properties)) {
        expect(everything).toHaveProperty(key);
      }
      const input = Object.fromEntries(
        Object.keys(tool.inputSchema.properties).map((key) => [key, everything[key]]),
      );
      const argv = tool.cliArgs(input);
      expect({ tool: tool.name, unknown: await findUnknownFlag(full, argv) }).toEqual({
        tool: tool.name,
        unknown: null,
      });
    }
  });
});

describe("a bare parent command's string option takes a separate value", () => {
  test("`stack env --env prod` runs show with prod, not the subcommand `prod`", () => {
    const r = stack(["env", "--env", "prod"]);
    expect(r.stderr).not.toContain("Unknown command prod");
    expect(`${r.stdout}${r.stderr}`).toMatch(/stack init|stack env show \(prod\)|\.stack\.toml/);
  });

  test("bindParentOptionValues joins only the parent's own string options", async () => {
    const { bindParentOptionValues } = await import("../lib/unknown-flags.ts");
    expect(await bindParentOptionValues(envCommand, ["--env", "prod"])).toEqual(["--env=prod"]);
    expect(await bindParentOptionValues(envCommand, ["--json", "show", "--env", "x"])).toEqual([
      "--json",
      "show",
      "--env",
      "x",
    ]);
    expect(await bindParentOptionValues(envCommand, ["export", "--stdout"])).toEqual([
      "export",
      "--stdout",
    ]);
  });
});
