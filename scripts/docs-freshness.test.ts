import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
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
function registeredCommands(): { name: string; file: string }[] {
  const source = ts.createSourceFile(
    "index.ts",
    read("packages/cli/src/index.ts"),
    ts.ScriptTarget.Latest,
    true,
  );
  const commands: { name: string; file: string }[] = [];
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
        if (!file) throw new Error(`Unsupported CLI registration for ${name}`);
        commands.push({ name, file: `${file}.ts` });
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
      .filter((name) => name.endsWith(".ts"))
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
      for (const [, command] of examples) expect(commands.map(({ name }) => name)).toContain(command);
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

  test("table row extraction rejects missing, duplicate and empty sections", () => {
    expect(() => tableRows("", "README.md", "commands-table")).toThrow();
    expect(() => tableRows(`${readme}\n${readme}`, "README.md", "commands-table")).toThrow();
    expect(() =>
      tableRows("<!-- fresh:begin commands-table -->\n<!-- fresh:end -->\n", "README.md", "commands-table"),
    ).toThrow();
  });
});
