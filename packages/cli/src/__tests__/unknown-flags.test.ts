import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";

import { checkFlags, editDistance } from "../lib/unknown-flags.ts";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

/** A `phantom` that answers --version and runs `exec -- cmd` directly. */
function fakePhantomDir(): string {
  const dir = tmp("stack-flags-phantom-");
  const bin = join(dir, "phantom");
  writeFileSync(
    bin,
    `#!/bin/sh
case "$1" in
  --version) echo "phantom fake 0.0.1" ;;
  exec) shift; [ "$1" = "--" ] && shift; exec "$@" ;;
  *) exit 0 ;;
esac
`,
  );
  chmodSync(bin, 0o755);
  return dir;
}

function stack(args: string[], opts: { cwd?: string; path?: string } = {}) {
  const cwd = opts.cwd ?? tmp("stack-flags-");
  const r = spawnSync("bun", [CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      PATH: opts.path ?? process.env.PATH ?? "",
      HOME: cwd,
      NO_COLOR: "1",
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
    },
    timeout: 20_000,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function stderrLines(s: string): string[] {
  return s.split("\n").filter((l) => l.trim() !== "");
}

describe("unknown flags exit 1 with one line naming the flag", () => {
  test("stack list --jsno suggests --json", () => {
    const r = stack(["list", "--jsno"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(stderrLines(r.stderr)).toEqual([
      "unknown option --jsno for stack list; did you mean --json?",
    ]);
  });

  test("stack init --json (init has no --json) is refused before anything is written", () => {
    const cwd = tmp("stack-flags-init-");
    const r = stack(["init", "--json"], { cwd });
    expect(r.code).toBe(1);
    expect(stderrLines(r.stderr)).toEqual([
      "unknown option --json for stack init; run `stack init --help` for its options",
    ]);
    expect(spawnSync("ls", ["-A", cwd], { encoding: "utf8" }).stdout).not.toContain(".stack.toml");
  });

  test("stack remove x --json is refused", () => {
    const r = stack(["remove", "x", "--json"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown option --json for stack remove");
  });

  test("kebab typo on stack add suggests the kebab spelling", () => {
    const r = stack(["add", "supabase", "--dry-runn"]);
    expect(r.code).toBe(1);
    expect(stderrLines(r.stderr)).toEqual([
      "unknown option --dry-runn for stack add; did you mean --dry-run?",
    ]);
  });

  test("nested subcommand: stack templates apply x --dry-run is not silently ignored", () => {
    const r = stack(["templates", "apply", "x", "--dry-run"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown option --dry-run for stack templates apply");
  });

  test("bare parent forwarding to a default subcommand: stack templates --jsno", () => {
    const r = stack(["templates", "--jsno"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown option --jsno for stack templates; did you mean --json?");
  });

  test("unknown short flag", () => {
    const r = stack(["info", "supabase", "-z"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown option -z for stack info");
  });

  test("with --json the error is JSON on stdout", () => {
    const r = stack(["list", "--json", "--jsno"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({
      error: "unknown option --jsno for stack list; did you mean --json?",
    });
  });
});

describe("what must keep working", () => {
  test("stack exec passes flags after -- (and -h) to the wrapped command", () => {
    const cwd = tmp("stack-flags-exec-");
    writeFileSync(join(cwd, ".stack.toml"), '[stack]\nversion = "1"\n');
    const path = `${fakePhantomDir()}:${process.env.PATH ?? ""}`;
    const r = stack(["exec", "--", "sh", "-c", 'echo "$@"', "sh", "--anything", "-h"], {
      cwd,
      path,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("--anything -h\n");
  });

  test("stack exec without -- is free-form too", () => {
    const cwd = tmp("stack-flags-exec2-");
    writeFileSync(join(cwd, ".stack.toml"), '[stack]\nversion = "1"\n');
    const path = `${fakePhantomDir()}:${process.env.PATH ?? ""}`;
    const r = stack(["exec", "echo", "--whatever"], { cwd, path });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("--whatever\n");
  });

  test("--help and -h still print usage", () => {
    for (const flag of ["--help", "-h"]) {
      const r = stack(["list", flag]);
      expect(r.code).toBe(0);
      expect(`${r.stdout}${r.stderr}`).toContain("USAGE stack list");
    }
  });

  test("--version still prints the version", () => {
    const r = stack(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("checkFlags", () => {
  const leaf = defineCommand({
    meta: { name: "apply" },
    args: {
      name: { type: "positional", required: true },
      dryRun: { type: "boolean" },
      continueOnError: { type: "boolean", default: true },
      noRollback: { type: "boolean" },
      region: { type: "string" },
      force: { type: "boolean", alias: "f" },
      verbose: { type: "boolean", alias: "V" },
    },
  });
  const root = defineCommand({
    meta: { name: "stack" },
    args: { json: { type: "boolean" } },
    subCommands: {
      apply: leaf,
      exec: defineCommand({ meta: { name: "exec" } }),
      list: defineCommand({ meta: { name: "list" }, args: { json: { type: "boolean" } } }),
    },
  });

  test("accepts declared flags in camel and kebab form, values, aliases and bundles", async () => {
    const argv = [
      "apply",
      "x",
      "--dry-run",
      "--dryRun",
      "--region=us-east-1",
      "--region",
      "eu",
      "-fV",
    ];
    expect(await checkFlags(root, argv)).toEqual({ ok: true, args: argv });
  });

  test("accepts --no-<arg> negation", async () => {
    const argv = ["apply", "x", "--no-continue-on-error", "--no-continueOnError"];
    expect(await checkFlags(root, argv)).toEqual({ ok: true, args: argv });
  });

  test("rewrites --no-rollback to the declared --noRollback", async () => {
    expect(await checkFlags(root, ["apply", "x", "--no-rollback"])).toEqual({
      ok: true,
      args: ["apply", "x", "--noRollback"],
    });
  });

  test("ignores everything after --, negative numbers and a lone -", async () => {
    const argv = ["apply", "x", "-", "-1", "--", "--anything", "-z"];
    expect(await checkFlags(root, argv)).toEqual({ ok: true, args: argv });
  });

  test("free-form commands are not checked", async () => {
    const argv = ["exec", "npm", "test", "--watch"];
    expect(await checkFlags(root, argv)).toEqual({ ok: true, args: argv });
  });

  test("an unknown subcommand is left for citty to report", async () => {
    const argv = ["nope", "--bogus"];
    expect(await checkFlags(root, argv)).toEqual({ ok: true, args: argv });
  });

  test("flags before the subcommand belong to the parent", async () => {
    expect((await checkFlags(root, ["--json", "list"])).ok).toBe(true);
    const r = await checkFlags(root, ["--force", "apply", "x"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.command).toBe("stack");
  });

  test("suggestion follows the user's spelling and stays quiet when nothing is close", async () => {
    const camel = await checkFlags(root, ["apply", "x", "--dryRn"]);
    const kebab = await checkFlags(root, ["apply", "x", "--dry-rn"]);
    const far = await checkFlags(root, ["apply", "x", "--zzzzzz"]);
    expect(!camel.ok && camel.error.suggestion).toBe("--dryRun");
    expect(!kebab.ok && kebab.error.suggestion).toBe("--dry-run");
    expect(!far.ok && far.error.suggestion).toBeUndefined();
  });

  test("json is only set when the command declares --json and it was passed", async () => {
    const withJson = await checkFlags(root, ["list", "--json", "--bogus"]);
    const without = await checkFlags(root, ["list", "--bogus"]);
    expect(!withJson.ok && withJson.error.json).toBe(true);
    expect(!without.ok && without.error.json).toBe(false);
  });

  test("editDistance counts a transposition as one edit", () => {
    expect(editDistance("jsno", "json")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
  });
});
