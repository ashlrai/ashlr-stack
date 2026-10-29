import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandDescriptions, commandLoaders } from "../commands.ts";

const CLI_ENTRY = join(import.meta.dir, "..", "index.ts");
const created: string[] = [];

afterEach(() => {
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

function stack(
  args: string[],
  options: { guardImports?: boolean; statusOnly?: boolean; fakePhantom?: boolean } = {},
) {
  const cwd = mkdtempSync(join(tmpdir(), "stack-startup-"));
  created.push(cwd);
  const preload = join(cwd, "guard.ts");
  if (options.guardImports || options.statusOnly) {
    // A behavioral import boundary, rather than a machine-dependent timing assertion.
    // The status positive control below proves this hook actually rejects command loads.
    writeFileSync(
      preload,
      `import { plugin } from "bun";
plugin({ name: "startup-import-boundary", setup(builder) {
  builder.onLoad({ filter: /\\/(?:commands\\/|packages\\/core\\/src\\/)/ }, async ({ path }) => {
    if (${options.statusOnly === true} && /\\/(?:commands\\/status|core\\/src\\/(?:config|phantom|errors|telemetry))\\.ts$/.test(path)) return { contents: await Bun.file(path).text(), loader: "ts" };
    throw new Error("UNEXPECTED_STARTUP_IMPORT: " + path);
  });
} });
`,
    );
  }
  if (options.fakePhantom) {
    writeFileSync(
      join(cwd, ".stack.toml"),
      '[stack]\nversion = "1"\nproject_id = "startup-test"\n',
    );
    const phantom = join(cwd, "phantom");
    writeFileSync(
      phantom,
      `#!${process.execPath}
const args = process.argv.slice(2);
console.log(args[0] === "--version" ? "phantom 0.0.0" : args[0] === "list" ? "[]" : JSON.stringify(args));
`,
    );
    chmodSync(phantom, 0o755);
  }
  const result = spawnSync(
    process.execPath,
    [
      ...(options.guardImports || options.statusOnly ? ["--preload", preload] : []),
      CLI_ENTRY,
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        PATH: `${cwd}:${process.env.PATH ?? ""}`,
        HOME: cwd,
        NO_COLOR: "1",
        STACK_NO_UPDATE_CHECK: "1",
        ...(options.statusOnly ? {} : { STACK_TELEMETRY: "0" }),
      },
      timeout: 20_000,
    },
  );
  return { ...result, files: readdirSync(cwd).filter((name) => name !== "guard.ts") };
}

describe("CLI startup fast paths", () => {
  test("the entry point retains the source-version literal required by release validation", () => {
    const source = readFileSync(CLI_ENTRY, "utf8");
    const declarations = [
      ...source.matchAll(/^const[ \t]+VERSION[ \t]*=[ \t]*([^;\r\n]+);[ \t]*$/gm),
    ];
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf8"));
    expect(declarations).toHaveLength(1);
    expect(JSON.parse(declarations[0]![1])).toBe(pkg.version);
  });

  test("root help descriptions match the lazily loaded command definitions", async () => {
    expect(Object.keys(commandDescriptions)).toEqual(Object.keys(commandLoaders));
    for (const name of Object.keys(commandLoaders) as Array<keyof typeof commandLoaders>) {
      const command = await commandLoaders[name]();
      const meta = await (typeof command.meta === "function" ? command.meta() : command.meta);
      expect(meta?.name).toBe(name);
      expect(meta?.description).toBe(commandDescriptions[name]);
    }
  });

  test("the import guard rejects a command implementation when it is actually requested", () => {
    const result = stack(["status"], { guardImports: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("UNEXPECTED_STARTUP_IMPORT");
  });

  test("status loads only its own implementation and narrow core dependencies", () => {
    const result = stack(["status", "--json"], { statusOnly: true, fakePhantom: true });
    expect({ code: result.status, stderr: result.stderr }).toEqual({ code: 0, stderr: "" });
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "ashlr.stack.status/v1",
      phantom: { installed: true, secret_count: 0 },
    });
    expect(result.stderr).toBe("");
  });

  test("lone --version prints only semver without loading commands or core", () => {
    const result = stack(["--version"], { guardImports: true });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.stderr).toBe("");
    expect(result.files).toEqual([]);
  });

  test("-v preserves platform and runtime details without loading commands or core", () => {
    const result = stack(["-v"], { guardImports: true });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^stack \d+\.\d+\.\d+\n/);
    expect(result.stdout).toContain(`platform: ${process.platform}-${process.arch}`);
    expect(result.stdout).toContain("bun:");
    expect(result.stderr).toBe("");
    expect(result.files).toEqual([]);
  });

  test("--version --json preserves the machine-readable runtime fields", () => {
    const result = stack(["--version", "--json"], { guardImports: true });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      platform: `${process.platform}-${process.arch}`,
      bun: expect.any(String),
      node: expect.stringMatching(/^v\d+/),
    });
    expect(result.stderr).toBe("");
    expect(result.files).toEqual([]);
  });

  for (const flag of ["--help", "-h"]) {
    test(`${flag} lists every command without loading implementations or creating state`, () => {
      const result = stack([flag], { guardImports: true });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("USAGE");
      const commands = readdirSync(join(import.meta.dir, "..", "commands"))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => name.slice(0, -3));
      for (const name of commands)
        expect(result.stdout).toMatch(new RegExp(`^\\s+${name}\\s+`, "m"));
      expect(result.stderr).toBe("");
      expect(result.files).toEqual([]);
    });
  }

  test("version with an unknown flag still goes through argument validation", () => {
    const result = stack(["--version", "--bogus"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option --bogus");
  });

  test("a subcommand does not acquire a root version flag", () => {
    const result = stack(["status", "--version"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Unknown option --version for `stack status`");
  });

  test("nested help still includes the selected command's arguments", () => {
    const result = stack(["templates", "apply", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("USAGE templates apply");
    expect(result.stdout).toContain("<NAME>");
  });

  for (const flag of ["--version", "--help", "-h"]) {
    test(`exec forwards ${flag} after -- to the wrapped command`, () => {
      const result = stack(["exec", "--", "tool", flag], { fakePhantom: true });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(["exec", "--", "tool", flag]);
      expect(result.stderr).toBe("");
    });
  }
});
