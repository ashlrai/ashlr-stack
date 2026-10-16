import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

describe("CLI Phantom admission with an inert producer", () => {
  let root: string;
  let target: string;
  let launch: string;
  let bin: string;
  let log: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "stack-cli-admission-")));
    target = join(root, "target");
    launch = join(root, "launch");
    bin = join(root, "bin");
    log = join(root, "calls");
    for (const dir of [target, launch, bin, join(root, "home"), join(root, "registry")])
      mkdirSync(dir);
    writeFileSync(log, "");
    writeFileSync(
      join(target, ".stack.toml"),
      '[stack]\nversion = "1"\n[services.openai]\nprovider = "openai"\nsecrets = ["OPENAI_API_KEY"]\n',
    );
    writeFileSync(join(target, ".stack.local.toml"), '[stack]\nproject_id = "stk_fixture"\n');
    writeFileSync(
      join(root, "registry", "projects.json"),
      JSON.stringify({
        version: "1",
        projects: [
          {
            path: target,
            name: "target",
            project_id: "stk_fixture",
            services: ["openai"],
            last_seen: new Date(0).toISOString(),
          },
        ],
      }),
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function producer(
    opts: { list?: "known" | "failed" | "malformed" | "wrongshape"; initialized?: boolean } = {},
  ): void {
    const list =
      opts.list === "failed"
        ? "exit 9"
        : opts.list === "malformed"
          ? "echo not-json"
          : opts.list === "wrongshape"
            ? "echo '[\"OPENAI_API_KEY\"]'"
            : `if [ "$PWD" = ${quote(target)} ]; then echo '[{"name":"OPENAI_API_KEY"}]'; else echo '[]'; fi`;
    const script = `#!/bin/sh
printf '%s\\n' "$1" >> ${quote(log)}
case "$1" in
 --version) echo fixture;;
 status) echo '{"schema_version":1,"inspection":"metadata-only","initialized":${opts.initialized !== false}}';;
 list) ${list};;
 reveal) echo 'Refusing to reveal without attached terminals' >&2; exit 1;;
 *) exit 88;;
esac
`;
    writeFileSync(join(bin, "phantom"), script);
    chmodSync(join(bin, "phantom"), 0o700);
  }

  function run(args: string[], cwd: string) {
    // Known Bun executable, private homes/registry, finite child bound, inert
    // Phantom first on PATH. Credential environment variables are not forwarded.
    const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: join(root, "home"),
        USERPROFILE: join(root, "home"),
        STACK_REGISTRY_DIR: join(root, "registry"),
        NO_COLOR: "1",
        CI: "1",
      },
    });
    // Bun 1.2.0 sets `error` on any non-zero exit; only a missing status means a real spawn failure.
    if (result.status === null) expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return { code: result.status, output: result.stdout + result.stderr };
  }

  test("doctor --all --fix screens the target vault, not the launch directory", () => {
    producer();
    const result = run(["doctor", "--all", "--fix"], launch);
    expect(result.code).toBe(1);
    expect(result.output).toContain("skipped — still stored in Phantom: OPENAI_API_KEY");
    expect(result.output).not.toContain("Re-running openai");
    expect(readFileSync(log, "utf8")).not.toMatch(/^add$|^init$/m);
  });

  test.each(["failed", "malformed", "wrongshape"] as const)(
    "doctor unavailable inventory blocks remediation (%s)",
    (list) => {
      producer({ list });
      const result = run(["doctor", "--all", "--fix"], launch);
      expect(result.code).toBe(1);
      expect(result.output).toContain("inventory is unavailable; remediation skipped");
      expect(result.output).not.toContain("Re-running openai");
      expect(readFileSync(log, "utf8")).not.toMatch(/^add$|^init$/m);
    },
  );

  test("import refuses uninitialized metadata before vault inventory or writes", () => {
    producer({ initialized: false });
    const sentinel = "synthetic-import-value";
    writeFileSync(join(launch, ".env"), `OPENAI_API_KEY=${sentinel}\n`);
    const result = run(["import"], launch);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("phantom init --empty");
    expect(result.output).not.toContain(sentinel);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["--version", "status"]);
    expect(readFileSync(join(launch, ".env"), "utf8")).toBe(`OPENAI_API_KEY=${sentinel}\n`);
  });
});
