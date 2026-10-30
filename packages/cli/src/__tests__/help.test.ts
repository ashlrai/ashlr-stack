import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// Registered top-level commands in declaration order. The parse mirrors
// scripts/freshness/lib.mjs: index.ts registers each command as a lazy
// `import("./commands/<file>.ts")` loader inside the `subCommands` object.
// index.ts cannot be imported here — its top-level code runs the CLI.
interface RegisteredCommand {
  name: string;
  file: string;
}

function registeredCommands(): RegisteredCommand[] {
  const source = readFileSync(CLI_ENTRY, "utf8");
  const block = source.match(/subCommands\s*:\s*\{([\s\S]*?)\n[ \t]*\}/);
  if (!block) throw new Error("packages/cli/src/index.ts: no subCommands object found");
  const entry =
    /["']?([\w-]+)["']?\s*:\s*\(\)\s*=>\s*import\(\s*["']\.\/commands\/([\w-]+)\.ts["']\s*\)/g;
  const commands = [...block[1].matchAll(entry)].map((m) => ({
    name: m[1],
    file: `${m[2]}.ts`,
  }));
  if (commands.length === 0)
    throw new Error("packages/cli/src/index.ts: subCommands has no lazy import() entries");
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
