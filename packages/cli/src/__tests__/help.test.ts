import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ENTRY = join(SRC_DIR, "index.ts");

// Help output must not read or write the real user profile.
const HOME = mkdtempSync(join(tmpdir(), "stack-help-"));
afterAll(() => rmSync(HOME, { recursive: true, force: true }));

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function stack(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      cwd: HOME,
      env: {
        PATH: process.env.PATH ?? "",
        HOME,
        NO_COLOR: "1",
        STACK_NO_UPDATE_CHECK: "1",
        STACK_TELEMETRY: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// index.ts cannot be imported here: its top-level code runs the CLI.
interface RegisteredCommand {
  name: string;
  file: string;
}

function registeredCommands(text = readFileSync(CLI_ENTRY, "utf8")): RegisteredCommand[] {
  const source = ts.createSourceFile(CLI_ENTRY, text, ts.ScriptTarget.Latest, true);
  const registries: ts.ObjectLiteralExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "subCommands") {
      if (!ts.isObjectLiteralExpression(node.initializer))
        throw new Error("Unsupported CLI subCommands registry");
      registries.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (registries.length !== 1) throw new Error("Expected one CLI subCommands registry");
  const commands = registries[0].properties.map((property) => {
    if (
      !ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    )
      throw new Error("Unsupported CLI command registration");
    const name = property.name.text;
    const file = property.initializer
      .getText(source)
      .match(/import\(\s*["']\.\/commands\/([\w-]+)\.ts["']\s*\)/)?.[1];
    if (!file) throw new Error(`Unsupported CLI command registration for ${name}`);
    return { name, file: `${file}.ts` };
  });
  if (commands.length === 0) throw new Error("CLI subCommands registry is empty");
  return commands;
}

const STRING_LITERAL = /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/;
const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t" };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const unquote = (literal: string) =>
  literal.slice(1, -1).replace(/\\(.)/g, (_all, ch: string) => ESCAPES[ch] ?? ch);

// The `meta { name, description }` literal of a command file, mirroring
// scripts/freshness/lib.mjs so the check tracks the same convention. citty
// renders backticks as inline-code markup, so they never reach the output.
function metaDescription(command: RegisteredCommand): string {
  const src = readFileSync(join(SRC_DIR, "commands", command.file), "utf8");
  const meta = src.match(
    new RegExp(
      `meta\\s*:\\s*\\{[^{}]*?name\\s*:\\s*["'\`]${escapeRe(command.name)}["'\`][^{}]*?description\\s*:\\s*${STRING_LITERAL.source}`,
    ),
  );
  if (!meta)
    throw new Error(`commands/${command.file}: no meta { name: "${command.name}", description }`);
  return unquote(meta[1]).replace(/`/g, "");
}

// Fully parallel spawns thrash (38 cold bun processes each want ~2s of CPU),
// so help pages are collected through a small worker pool.
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

function commandsSection(help: string): string[] {
  const start = help.indexOf("COMMANDS");
  const end = help.indexOf("Use stack <command> --help");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return help
    .slice(start, end)
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((first) => first !== "" && first !== "COMMANDS");
}

describe("stack --help", () => {
  test("registry parsing rejects entries it cannot account for", () => {
    expect(() => registeredCommands("({ subCommands: { init: initCommand } })")).toThrow(
      "Unsupported CLI command registration for init",
    );
    expect(() => registeredCommands("({ subCommands: { ...commands } })")).toThrow(
      "Unsupported CLI command registration",
    );
  });

  test("exits 0 and lists exactly the registered top-level commands", async () => {
    const commands = registeredCommands();
    const names = commands.map((c) => c.name);
    for (const flag of ["--help", "-h"]) {
      const r = await stack([flag]);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      const usage = r.stdout.split("\n").find((line) => line.startsWith("USAGE"));
      expect(usage).toBe(`USAGE stack [OPTIONS] ${names.join("|")}`);
      expect(commandsSection(r.stdout)).toEqual(names);
      for (const option of ["--version", "--json", "--ashlrHandshake"])
        expect(r.stdout).toContain(option);
      expect(r.stdout).toContain(
        "Use stack <command> --help for more information about a command.",
      );
    }
  }, 30_000);

  test("shows each registered command's meta description", async () => {
    const r = await stack(["--help"]);
    expect(r.code).toBe(0);
    for (const command of registeredCommands())
      expect(r.stdout).toContain(metaDescription(command));
  }, 30_000);
});

describe("stack <command> --help", () => {
  test("every registered command resolves its own help page and exits 0", async () => {
    const commands = registeredCommands();
    const results = await mapPool(commands, 8, (c) => stack([c.name, "--help"]));
    for (const [i, r] of results.entries()) {
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      expect(r.stdout).toContain(`USAGE stack ${commands[i].name}`);
    }
  }, 90_000);
});
