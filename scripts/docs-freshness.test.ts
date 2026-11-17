import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { normalizeKebabFlags } from "../packages/cli/src/lib/normalize-args.ts";
import {
  bindParentOptionValues,
  findUnknownFlag,
  unknownHelpCommand,
} from "../packages/cli/src/lib/unknown-flags.ts";
import { getProvider, listProviderNames } from "../packages/core/src/providers/index.ts";
import { TOOLS } from "../packages/mcp/src/tools.ts";
// @ts-expect-error no declarations; the shared freshness library is plain .mjs
import { buildContext, check, parseBlocks } from "./freshness/lib.mjs";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const readme = read("README.md");

// Rows of a generated fresh: table, as [first-cell, rest] pairs. Backticks are
// stripped the way the generators write them: first cell `code`, rest raw.
function tableRows(document: string, file: string, name: string): string[][] {
  const { blocks, errors } = parseBlocks(document, file);
  if (errors.length > 0) throw new Error(`${file}: malformed markers: ${errors.join("; ")}`);
  const matches = blocks.filter((block: { name: string }) => block.name === name);
  if (matches.length !== 1) throw new Error(`${file}: expected exactly one '${name}' block`);
  const rows = [...matches[0].inner.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)].map((match) => [
    match[1],
    match[2].replace(/^`|`$/g, ""),
  ]);
  if (rows.length === 0) throw new Error(`${file}: empty '${name}' table`);
  return rows;
}

// Parse the registration rather than counting files or importing index.ts,
// whose top-level code runs the CLI and its update/telemetry hooks.
function registeredCommands(): { name: string; file: string; exportName: string }[] {
  const source = ts.createSourceFile(
    "index.ts",
    read("packages/cli/src/index.ts"),
    ts.ScriptTarget.Latest,
    true,
  );
  const commands: { name: string; file: string; exportName: string }[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "subCommands" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) throw new Error("Unsupported CLI registration");
        const name = property.name.getText(source).replace(/['"]/g, "");
        const file = property.initializer
          .getText(source)
          .match(/import\(\s*["']\.\/commands\/([\w-]+)\.ts["']\s*\)/)?.[1];
        const exportName = property.initializer.getText(source).match(/=>\s*m\.(\w+)/)?.[1];
        if (!file || !exportName) throw new Error(`Unsupported CLI registration for ${name}`);
        commands.push({ name, file: `${file}.ts`, exportName });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (commands.length === 0) throw new Error("No CLI commands found");
  return commands;
}

// The meta { name: "<command>", description } literal of a command file, via
// the TypeScript AST so the check is independent of the .mjs regex parser.
function metaDescription(command: { name: string; file: string }): string {
  const path = `packages/cli/src/commands/${command.file}`;
  const source = ts.createSourceFile(command.file, read(path), ts.ScriptTarget.Latest, true);
  let found: string | undefined;
  function visit(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "meta" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      let name: string | undefined;
      let description: string | undefined;
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = property.name.getText(source).replace(/['"]/g, "");
        if (key === "name" && ts.isStringLiteralLike(property.initializer)) {
          name = property.initializer.text;
        }
        if (key === "description" && ts.isStringLiteralLike(property.initializer)) {
          description = property.initializer.text;
        }
      }
      if (name === command.name) found = description;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (found === undefined) throw new Error(`${path}: no meta description for ${command.name}`);
  return found;
}

const commands = registeredCommands();

// Extract code, not surrounding prose. Keep quoted arguments together and join
// shell continuations; npx and source-entry examples use the same CLI grammar.
function examples(document: string): { text: string; runnable: boolean }[] {
  const code = [...document.matchAll(/`([^`\n]+)`/g)].map((m) => ({
    text: m[1]!,
    runnable: false,
  }));
  for (const [, block] of document.matchAll(
    /```(?:bash|sh|shell|console|powershell)\n([\s\S]*?)```/g,
  )) {
    code.push(
      ...block!
        .replace(/\\\n\s*/g, " ")
        .split("\n")
        .map((text) => ({ text, runnable: true })),
    );
  }
  return code.flatMap(({ text, runnable }) => {
    const match = text
      .trim()
      .match(
        /^(?:\$ )?(?:stack|npx -y -p @ashlr\/stack stack|bun (?:run )?packages\/cli\/src\/index\.ts)(?:\s+(.+))?$/,
      );
    return match ? (match[1] ?? "").split(" → stack ").map((text) => ({ text, runnable })) : [];
  });
}

function declaredFlags(command: string): Set<string> {
  const source = ts.createSourceFile(
    `${command}.ts`,
    read(`packages/cli/src/commands/${command}.ts`),
    ts.ScriptTarget.Latest,
    true,
  );
  const flags = new Set(["help", "h"]);
  function visit(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "args" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = property.name.getText(source).replace(/['"]/g, "");
        flags.add(name);
        // The CLI normalizes kebab flags to the source's camelCase names.
        flags.add(name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return flags;
}

describe("source documentation freshness", () => {
  test("the freshness gate reports the working tree clean", () => {
    const { drifts, errors } = check(root);
    expect(errors).toEqual([]);
    expect(drifts).toEqual([]);
  });

  test("README command table lists every registered command, in source order", () => {
    const rows = tableRows(readme, "README.md", "commands-table");
    expect(rows.map(([name]) => name)).toEqual(commands.map(({ name }) => `stack ${name}`));
    // A new command file also needs registration and documentation.
    const files = readdirSync(resolve(root, "packages/cli/src/commands"))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .sort();
    expect(files).toEqual(commands.map(({ file }) => file).sort());
  });

  test("README command purposes match each file's meta description", () => {
    const rows = tableRows(readme, "README.md", "commands-table");
    const normalize = (text: string) => text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
    for (const [i, [, purpose]] of rows.entries()) {
      expect(purpose).toBe(normalize(metaDescription(commands[i]!)));
    }
  });

  test("README tool table lists every MCP tool and its CLI route exactly once", () => {
    const rows = tableRows(readme, "README.md", "tools-table");
    expect(rows.map(([name]) => name)).toEqual(TOOLS.map((tool) => tool.name));
    for (const [name, route] of rows) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Unknown documented tool: ${name}`);
      // Stop at flags or positional values; this checks the dispatch route,
      // without launching a CLI, provider or external process.
      const argv = tool.cliArgs({});
      const words = route.split(" ").slice(1);
      expect(argv.slice(0, words.length)).toEqual(words);
      expect(commands.map(({ name: c }) => c)).toContain(words[0]);
    }
  });

  test("generated counts match the runtime sources of truth", async () => {
    const { ctx, errors } = buildContext(root);
    expect(errors).toEqual([]);
    expect(ctx.source.commands().length).toBe(commands.length);
    expect(ctx.source.tools().length).toBe(TOOLS.length);
    const { providers, categories } = ctx.source.providers();
    const names = listProviderNames();
    expect(providers.length).toBe(names.length);
    const seen = new Set<string>();
    for (const name of names) seen.add((await getProvider(name)).category);
    expect(categories.size).toBe(seen.size);
  });

  test("orientation counts in README and STACK match source", () => {
    const stack = read("STACK.md");
    // Strip the fresh: markers so generated counts read as plain numbers.
    const rendered = (document: string) =>
      document.replace(/<!--\s*fresh:begin\s+[\w-]+\s*-->|<!--\s*fresh:end\s*-->/g, "");
    expect(rendered(stack)).toContain(`${commands.length} CLI commands`);
    expect(rendered(stack)).toContain(`${TOOLS.length} MCP tools`);
    expect(rendered(readme)).toContain(`registers ${commands.length} top-level commands`);
    expect(rendered(readme)).toContain(`declares ${TOOLS.length} tools`);
  });

  test("root CLI examples name registered commands", () => {
    for (const path of ["README.md", "STACK.md", "AGENTS.md"]) {
      const document = read(path);
      // Inline examples and shell lines. Options
      // such as --help and metavariables such as <command> are not commands.
      const examples = [...document.matchAll(/(?:`|^)stack ([a-z][a-z-]*)(?=[\s`])/gm)];
      if (path === "README.md") expect(examples.length).toBeGreaterThan(0);
      for (const [, command] of examples)
        expect(commands.map(({ name }) => name)).toContain(command);
      for (const [tool] of document.matchAll(/\bstack_[a-z_]+\b/g)) {
        expect(TOOLS.map((entry) => entry.name)).toContain(tool);
      }
    }
  });

  test("documented CLI example flags are declared by their command source", () => {
    const examples = [
      ...readme.matchAll(/`stack ([^`\n]+)`/g),
      ...readme.matchAll(/^stack ([^\n]+)/gm),
    ];
    let checked = 0;
    for (const [, example] of examples) {
      const command = example.split(/\s/)[0]!;
      if (!commands.some(({ name }) => name === command)) continue;
      const flags = declaredFlags(command);
      // Comments and argv after -- belong to prose or the child process.
      const invocation = example.split(/\s+#|\s+--(?:\s|$)/)[0]!;
      for (const [, flag] of invocation.matchAll(/--([a-zA-Z][\w-]*)/g)) {
        expect(flags.has(flag)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("every shipped doc names only real commands, subcommands and flags", async () => {
    const helpHome = mkdtempSync(join(tmpdir(), "stack-docs-help-"));
    const cli = (args: string[]) =>
      Bun.spawnSync([process.execPath, resolve(root, "packages/cli/src/index.ts"), ...args], {
        // Minimal env: the test runner's own variables make the CLI skip main.
        env: {
          PATH: process.env.PATH ?? "",
          HOME: helpHome,
          NO_COLOR: "1",
          STACK_NO_UPDATE_CHECK: "1",
          STACK_TELEMETRY: "0",
        },
        cwd: helpHome,
        timeout: 20_000,
      });
    const help = cli(["--help"]);
    const start = readme.split("## Get started\n")[1]?.split("\n### ")[0];
    expect(start).toBeDefined();
    expect(start!.match(/^\d+\. /gm)?.length).toBeLessThanOrEqual(5);
    expect(start).toContain("npm i -g @ashlr/stack");
    const firstCommand = examples(start!)[0]!.text;
    expect(firstCommand).toBe("providers --json"); // Only execute this local catalog read.
    const first = cli(firstCommand.split(" "));
    rmSync(helpHome, { recursive: true, force: true });
    expect(first.exitCode).toBe(0);
    const report = JSON.parse(first.stdout.toString());
    expect(report.schema).toBe("ashlr.stack.providers/v1");
    expect(report.total).toBe(report.providers.length);
    expect(report.total).toBeGreaterThan(0);
    expect(report.unavailable).toEqual([]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("USAGE stack");
    const options = help.stdout.toString().split("\nOPTIONS\n")[1]!.split("\nCOMMANDS\n")[0]!;
    const rootFlags = new Set([
      "--help",
      "-h",
      ...[...options.matchAll(/(?<![\w-])--?[A-Za-z][\w-]*/g)].map((m) => m[0]),
    ]);
    const definitions = new Map<string, Parameters<typeof findUnknownFlag>[0]>();
    for (const { name, file, exportName } of commands) {
      const module = await import(resolve(root, "packages/cli/src/commands", file));
      definitions.set(name, module[exportName]);
    }
    const validate = async (example: string, runnable = true) => {
      const tokens = [...example.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
        (m) => m[1] ?? m[2] ?? m[3]!,
      );
      const comment = tokens.findIndex((t) => ["#", "|", ">", ">>", "&&", "||"].includes(t));
      const argv = normalizeKebabFlags(
        (comment < 0 ? tokens : tokens.slice(0, comment)).map((t) => t.replace(/^\[|\]$/g, "")),
      );
      const name = argv.shift();
      // Explicit placeholders describe syntax, not a concrete invocation.
      if (!name || name.startsWith("<")) return;
      if (name.startsWith("-")) {
        for (const flag of [name, ...argv]) {
          if (!rootFlags.has(flag)) throw new Error(`Unknown root option: ${flag}`);
        }
        return;
      }
      const command = definitions.get(name);
      if (!command) throw new Error(`Unknown command: ${name}`);
      const args = await bindParentOptionValues(command, argv);
      const unknown = await unknownHelpCommand(command, args, `stack ${name}`);
      if (unknown) throw new Error(`Unknown subcommand: ${unknown.command} ${unknown.name}`);
      const flag = await findUnknownFlag(command, args, `stack ${name}`);
      // Inline prose can name a valued option without supplying its value.
      if (flag && (runnable || !flag.missingValue || args.at(-1) !== flag.flag))
        throw new Error(`${flag.command}: invalid argument ${flag.flag}`);
    };
    const walk = (dir: string): string[] =>
      readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
        return /\.(md|txt)$/.test(entry.name) ? [path] : [];
      });
    const files = [
      "README.md",
      "STACK.md",
      "llms.txt",
      ...walk("docs"),
      ...walk("templates"),
      "packages/site/public/llms.txt",
      "packages/site/public/llms-full.txt",
    ];
    let checked = 0;
    const errors: string[] = [];
    for (const path of files) {
      for (const { text, runnable } of examples(read(path))) {
        // This reference deliberately demonstrates a refused option order.
        if (path === "packages/site/public/llms-full.txt" && text === "--json list") {
          await expect(validate(text)).rejects.toThrow("Unknown root option: list");
          continue;
        }
        try {
          await validate(text, runnable);
        } catch (error) {
          errors.push(`${path}: stack ${text}: ${error}`);
        }
        checked++;
      }
    }
    expect(errors).toEqual([]);
    expect(checked).toBeGreaterThan(50);
    await expect(validate("scan --path --removed", false)).rejects.toThrow();
    for (const bad of [
      "removed-command",
      "env removed-subcommand",
      "env show --stdout",
      "templates list --no-continueOnError",
      "scan --path",
      "providers --jsn",
      "providers -z",
      "--removed",
    ]) {
      await expect(validate(bad)).rejects.toThrow();
    }
    for (const good of [
      "env --env prod",
      "upgrade -n",
      "add supabase --dry-run",
      "templates apply starter --no-continue-on-error",
      "exec -- child --anything",
      'recommend "app with auth" --json',
    ]) {
      await expect(validate(good)).resolves.toBeUndefined();
    }
    expect(examples("```bash\nnpx -y -p @ashlr/stack stack providers --jsn\n```")).toEqual([
      { text: "providers --jsn", runnable: true },
    ]);
  }, 120_000);

  test("table row extraction rejects missing, duplicate and empty sections", () => {
    expect(() => tableRows("", "README.md", "commands-table")).toThrow();
    expect(() => tableRows(`${readme}\n${readme}`, "README.md", "commands-table")).toThrow();
    expect(() =>
      tableRows(
        "<!-- fresh:begin commands-table -->\n<!-- fresh:end -->\n",
        "README.md",
        "commands-table",
      ),
    ).toThrow();
  });
});
