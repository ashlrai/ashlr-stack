import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every `stack <subcommand> --help` must print real help text: exit 0 and a
// non-empty stdout. Covers top-level commands from the index.ts registry and
// nested subcommands (`stack env show`, `stack fleet slo`, ...) discovered by
// walking each command's citty `subCommands` tree.

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_ENTRY = join(SRC_DIR, "index.ts");

// Help runs must not read or write the real user profile.
const HOME = mkdtempSync(join(tmpdir(), "stack-subhelp-"));

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

// Fails loudly when a help page is missing or blank. Exported as a plain
// function so the assertion itself can be exercised below.
function expectNonEmptyHelp(path: string[], r: CliResult): void {
  const label = `stack ${path.join(" ")} --help`;
  expect({ command: label, code: r.code }).toEqual({ command: label, code: 0 });
  expect({ command: label, empty: r.stdout.trim() === "" }).toEqual({
    command: label,
    empty: false,
  });
}

// index.ts cannot be imported: its top-level code runs the CLI. Registrations
// are read from source as `name: () => import("./commands/<file>.ts")...`.
interface Registration {
  name: string;
  file: string;
  exportName: string;
}

function registrations(text = readFileSync(CLI_ENTRY, "utf8")): Registration[] {
  const pattern =
    /^\s*("?[\w-]+"?|\w+)\s*:\s*\(\)\s*=>\s*import\(\s*["']\.\/commands\/([\w-]+)\.ts["']\s*\)\s*\.then\(\s*\(?m\)?\s*=>\s*m\.(\w+)\s*\)/gm;
  const found: Registration[] = [];
  for (const match of text.matchAll(pattern)) {
    found.push({
      name: match[1].replace(/"/g, ""),
      file: `${match[2]}.ts`,
      exportName: match[3],
    });
  }
  // Fail closed: every import() in the registry must have parsed.
  const imports = text.match(/import\(\s*["']\.\/commands\//g)?.length ?? 0;
  if (found.length === 0 || found.length !== imports)
    throw new Error(`Parsed ${found.length} of ${imports} CLI command registrations`);
  return found;
}

type Resolvable = unknown;

interface CittyCommand {
  subCommands?: Record<string, Resolvable>;
}

async function resolveCommand(value: Resolvable): Promise<CittyCommand> {
  const resolved = typeof value === "function" ? (value as () => unknown)() : value;
  return (await resolved) as CittyCommand;
}

// Walks the subCommands tree and returns the argv path of every subcommand.
async function commandPaths(command: CittyCommand, prefix: string[] = []): Promise<string[][]> {
  const paths: string[][] = [];
  for (const [name, value] of Object.entries(command.subCommands ?? {})) {
    const path = [...prefix, name];
    paths.push(path);
    paths.push(...(await commandPaths(await resolveCommand(value), path)));
  }
  return paths;
}

async function allCommandPaths(): Promise<string[][]> {
  const paths: string[][] = [];
  for (const reg of registrations()) {
    const mod = (await import(join(SRC_DIR, "commands", reg.file))) as Record<string, Resolvable>;
    const command = await resolveCommand(mod[reg.exportName]);
    paths.push([reg.name], ...(await commandPaths(command, [reg.name])));
  }
  return paths;
}

// Runs jobs through a small worker pool. Fully parallel spawns thrash (each
// cold bun process wants ~1s of CPU), so this keeps the run steady.
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

describe("subcommand --help discovery", () => {
  test("registry parsing fails closed on an unparseable registration", () => {
    expect(() => registrations("({ subCommands: { init: initCommand } })")).toThrow(
      "Parsed 0 of 0 CLI command registrations",
    );
    expect(() =>
      registrations('x: () => import("./commands/init.ts"), y: () => import("./commands/y.ts")'),
    ).toThrow("Parsed 0 of 2 CLI command registrations");
  });

  test("top-level registry covers every commands/ import in index.ts", () => {
    const names = registrations().map((r) => r.name);
    expect(names.length).toBeGreaterThanOrEqual(40);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("fleet-collisions");
    expect(names).toContain("env");
  });

  test("walks nested subcommands of group commands", async () => {
    const paths = await allCommandPaths();
    expect(paths).toContainEqual(["env", "show"]);
    expect(paths).toContainEqual(["fleet", "slo"]);
    expect(paths).toContainEqual(["projects", "list"]);
    expect(paths).toContainEqual(["telemetry", "status"]);
    expect(paths.length).toBeGreaterThan(registrations().length);
  });
});

describe("stack <subcommand> --help is never empty", () => {
  test("every subcommand, top-level and nested, exits 0 with non-empty help", async () => {
    const paths = await allCommandPaths();
    const results = await mapPool(paths, 8, (path) => stack([...path, "--help"]));
    for (const [i, r] of results.entries()) expectNonEmptyHelp(paths[i], r);
  }, 240_000);

  test("the empty-help check rejects blank output and non-zero exits", () => {
    expect(() => expectNonEmptyHelp(["x"], { code: 0, stdout: "  \n", stderr: "" })).toThrow();
    expect(() => expectNonEmptyHelp(["x"], { code: 1, stdout: "help", stderr: "" })).toThrow();
    expect(() => expectNonEmptyHelp(["x"], { code: 0, stdout: "help", stderr: "" })).not.toThrow();
  });
});
