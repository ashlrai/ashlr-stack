import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { TOOLS } from "../packages/mcp/src/tools.ts";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const readme = read("README.md");

function tableRows(document: string, section: string): string[][] {
  const start = `<!-- freshness:${section}:start -->`;
  const end = `<!-- freshness:${section}:end -->`;
  if (document.split(start).length !== 2 || document.split(end).length !== 2) {
    throw new Error(`Expected one ${section} table with start/end markers`);
  }
  const body = document.split(start)[1].split(end)[0];
  const rows = [...body.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)].map((match) => [
    match[1],
    match[2].replace(/^`|`$/g, ""),
  ]);
  if (rows.length === 0) throw new Error(`Empty ${section} table`);
  return rows;
}

// Parse the registration rather than counting files or importing index.ts,
// whose top-level code runs the CLI and its update/telemetry hooks.
function registeredCommands(): string[] {
  const source = ts.createSourceFile(
    "index.ts",
    read("packages/cli/src/index.ts"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === "subCommands" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) throw new Error("Unsupported CLI registration");
        names.push(property.name.getText(source).replace(/['"]/g, ""));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (names.length === 0) throw new Error("No CLI commands found");
  return names;
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
  test("README lists every registered command exactly once, in source order", () => {
    expect(tableRows(readme, "commands").map(([name]) => name)).toEqual(
      commands.map((name) => `stack ${name}`),
    );
    // A new command file also needs registration and documentation.
    const files = readdirSync(resolve(root, "packages/cli/src/commands"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.slice(0, -3));
    expect(files.sort()).toEqual([...commands].sort());
  });

  test("README lists every MCP tool and its CLI route exactly once", () => {
    const rows = tableRows(readme, "tools");
    expect(rows.map(([name]) => name)).toEqual(TOOLS.map((tool) => tool.name));
    for (const [name, route] of rows) {
      const tool = TOOLS.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Unknown documented tool: ${name}`);
      // Stop at flags or positional values; this checks the dispatch route,
      // without launching a CLI, provider or external process.
      const argv = tool.cliArgs({});
      const words = route.split(" ").slice(1);
      expect(argv.slice(0, words.length)).toEqual(words);
      expect(commands).toContain(words[0]);
    }
  });

  test("orientation counts match source", () => {
    const stack = read("STACK.md");
    expect(stack).toContain(`${commands.length} CLI commands`);
    expect(stack).toContain(`${TOOLS.length} MCP tools`);
    expect(readme).toContain(`registers ${commands.length} top-level commands`);
    expect(readme).toContain(`declares ${TOOLS.length} tools`);
  });

  test("root CLI examples name registered commands", () => {
    for (const path of ["README.md", "AGENTS.md"]) {
      const document = read(path);
      // Inline examples and shell lines. Options
      // such as --help and metavariables such as <command> are not commands.
      const examples = [...document.matchAll(/(?:`|^)stack ([a-z][a-z-]*)(?=[\s`])/gm)];
      expect(examples.length).toBeGreaterThan(0);
      for (const [, command] of examples) expect(commands).toContain(command);
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
      const command = example.split(/\s/)[0];
      if (!commands.includes(command)) continue;
      const flags = declaredFlags(command);
      // Comments and argv after -- belong to prose or the child process.
      const invocation = example.split(/\s+#|\s+--(?:\s|$)/)[0];
      for (const [, flag] of invocation.matchAll(/--([a-zA-Z][\w-]*)/g)) {
        expect(flags.has(flag)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("table parser rejects missing, duplicate and empty sections", () => {
    expect(() => tableRows("", "commands")).toThrow();
    expect(() => tableRows(readme + readme, "commands")).toThrow();
    expect(() =>
      tableRows("<!-- freshness:commands:start --><!-- freshness:commands:end -->", "commands"),
    ).toThrow();
  });
});
