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
  test("a typo exits 1, names the option and the closest real one", () => {
    const r = stack(["templates", "list", "--jsn"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Unknown option --jsn for `stack templates list`");
    expect(r.stderr).toContain("Did you mean --json?");
    expect(r.stderr).toContain("Run `stack templates list --help`");
  });

  test("an option the command lacks is an error, as JSON on stdout when --json was asked for", () => {
    // `stack upgrade` has no --json; it used to print its human banner with exit 0.
    const r = stack(["upgrade", "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).error).toContain("Unknown option --json for `stack upgrade`");
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
    templates: templatesCommand,
    upgrade: upgradeCommand,
  },
}) as CommandDef;

const unknown = (argv: string[]) => findUnknownFlag(main, normalizeKebabFlags(argv));

describe("findUnknownFlag accepts every declared spelling", () => {
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
    expect(await unknown(["--json", "upgrade"])).toMatchObject({
      flag: "--json",
      command: "stack upgrade",
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
