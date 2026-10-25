import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIX_TOOLS,
  type FixTool,
  FixUsageError,
  LOCUS_MANUAL_APPLY_REASON,
  fixEnv,
  parseApplyArg,
  runDoctorFix,
  summarizeDoctorFixPreview,
} from "../lib/doctor-fix.ts";
import type { EcosystemEntry } from "../lib/ecosystem.ts";

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

const PREVIEW_JSON = JSON.stringify({
  mode: "dry_run",
  phantom_names: { status: "unavailable", reason: "no_phantom_project" },
  plan: { fixes: [{ kind: "x" }, { kind: "y" }], report_only: [{ code: "z" }] },
  outcome: null,
});

/**
 * A fake companion: answers the handshake (with or without doctor-fix), logs
 * every other invocation's argv and env to `<log>`, and exits `applyExit` for
 * `doctor --fix --apply`.
 */
function fakeTool(
  bin: string,
  name: string,
  log: string,
  opts: { cap?: boolean; applyExit?: number } = {},
) {
  const hs = JSON.stringify({
    kind: "ashlr.handshake",
    schema_version: 1,
    name,
    version: "9.9.9",
    capabilities: opts.cap === false ? ["other"] : ["doctor-fix"],
    health: { status: "ok" },
  });
  writeFileSync(
    join(bin, name),
    `#!/bin/sh
if [ "$1" = "--ashlr-handshake" ]; then printf '%s\\n' '${hs}'; exit 0; fi
{ echo "ARGV $*"; env | sed 's/^/ENV /'; } >> ${JSON.stringify(log)}
case "$*" in
  "doctor --fix --json") printf '%s\\n' '${PREVIEW_JSON}'; exit 0 ;;
  "doctor --fix --apply") exit ${opts.applyExit ?? 0} ;;
esac
exit 3
`,
  );
  chmodSync(join(bin, name), 0o755);
}

function tableFor(names: string[]): FixTool[] {
  return names.map((n) => ({
    tool: n,
    command: n,
    capability: "doctor-fix",
    previewArgv: ["doctor", "--fix", "--json"],
    previewReadOnly: true,
    applyArgv: ["doctor", "--fix", "--apply"],
    envPassthrough: ["LOCUS_HOME"],
    summarizePreview: summarizeDoctorFixPreview,
  }));
}

const SECRET_ENV = {
  OPENAI_API_KEY: "SECRET_VALUE",
  GITHUB_TOKEN: "SECRET_VALUE",
  LOCUS_CONTROL_CAPABILITY: "SECRET_VALUE",
  PHANTOM_TOKEN: "phm_SECRET_VALUE",
};

describe("pure helpers", () => {
  test("parseApplyArg: absent, bare and lists", () => {
    expect(parseApplyArg(["--ecosystem", "--fix"])).toBeUndefined();
    expect(parseApplyArg(["--fix", "--apply"])).toEqual([]);
    expect(parseApplyArg(["--apply", "--json"])).toEqual([]);
    expect(parseApplyArg(["--apply", "locus,lexicon"])).toEqual(["locus", "lexicon"]);
    expect(parseApplyArg(["--apply=locus"])).toEqual(["locus"]);
  });
  test("summarizeDoctorFixPreview accepts only the documented dry-run shape", () => {
    expect(summarizeDoctorFixPreview(PREVIEW_JSON)).toBe(
      "2 fix(es) would be applied, 1 finding(s) to handle by hand",
    );
    expect(
      summarizeDoctorFixPreview('{"mode":"apply","plan":{"fixes":[],"report_only":[]}}'),
    ).toBeNull();
    expect(summarizeDoctorFixPreview("nope")).toBeNull();
  });
  test("child env is the allowlist plus the tool's store variable, never secrets", () => {
    const env = fixEnv(tableFor(["locus"])[0] as FixTool, {
      PATH: "/bin",
      HOME: "/h",
      LOCUS_HOME: "/l",
      LOCUS_SESSION_ID: "s",
      ...SECRET_ENV,
    });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", LOCUS_HOME: "/l", NO_COLOR: "1" });
  });
  test("tools without the capability are info in preview, refused for apply, never run", async () => {
    const calls: string[][] = [];
    const runner = async (_c: string, argv: string[]) => {
      calls.push(argv);
      return { kind: "exited" as const, code: 0, stdout: PREVIEW_JSON };
    };
    const entries: EcosystemEntry[] = [
      { name: "a", command: "a", status: "ok", capabilities: ["doctor-fix"] },
      { name: "b", command: "b", status: "ok", capabilities: [] },
      { name: "c", command: "c", status: "missing" },
    ];
    const prev = await runDoctorFix(undefined, {
      table: tableFor(["a", "b", "c"]),
      entries,
      runner,
    });
    expect(prev.tools.map((t) => t.outcome)).toEqual(["previewed", "no_capability", "missing"]);
    expect(calls).toEqual([["doctor", "--fix", "--json"]]);
    calls.length = 0;
    await expect(
      runDoctorFix(["a", "b"], { table: tableFor(["a", "b", "c"]), entries, runner }),
    ).rejects.toThrow("b does not advertise the doctor-fix capability; nothing was run");
    await expect(
      runDoctorFix(["$(x)"], { table: tableFor(["a"]), entries, runner }),
    ).rejects.toThrow("<invalid name>");
    expect(calls).toEqual([]);
  });
  test("a preview not documented read-only is listed, not run", async () => {
    const t = { ...(tableFor(["a"])[0] as FixTool), previewReadOnly: false };
    let ran = false;
    const r = await runDoctorFix(undefined, {
      table: [t],
      entries: [{ name: "a", command: "a", status: "ok", capabilities: ["doctor-fix"] }],
      runner: async () => {
        ran = true;
        return { kind: "exited", code: 0, stdout: "" };
      },
    });
    expect(ran).toBe(false);
    expect(r.tools[0]?.outcome).toBe("available");
  });
});

// Real child processes with fake POSIX sh companions. Skipped on Windows: the
// fakes are sh scripts and Stack spawns without a shell, which cannot run a
// .cmd shim there. The logic above runs on every platform.
describe.skipIf(process.platform === "win32")("doctor --fix with fake companions", () => {
  function world(specs: [string, { cap?: boolean; applyExit?: number }][]) {
    const bin = tmp("stack-fix-bin-");
    const logs: Record<string, string> = {};
    for (const [name, opts] of specs) {
      logs[name] = join(bin, `${name}.log`);
      fakeTool(bin, name, logs[name] as string, opts);
    }
    const env = {
      ...SECRET_ENV,
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: bin,
      LOCUS_HOME: join(bin, "lh"),
    };
    const read = (n: string) =>
      existsSync(logs[n] as string) ? readFileSync(logs[n] as string, "utf8") : "";
    return { bin, env, read };
  }

  test("preview runs no apply argv", async () => {
    const w = world([
      ["a", {}],
      ["b", {}],
    ]);
    const saved = process.env.PATH;
    process.env.PATH = w.env.PATH;
    try {
      const r = await runDoctorFix(undefined, { table: tableFor(["a", "b"]), env: w.env });
      expect(r.mode).toBe("preview");
      expect(r.tools.map((t) => t.outcome)).toEqual(["previewed", "previewed"]);
    } finally {
      process.env.PATH = saved;
    }
    for (const n of ["a", "b"]) {
      expect(w.read(n)).toContain("ARGV doctor --fix --json");
      expect(w.read(n)).not.toContain("--apply");
    }
  });

  test("apply runs only opted-in tools, stops on first refusal, later tools not run, no secrets", async () => {
    const w = world([
      ["a", {}],
      ["b", { applyExit: 1 }],
      ["c", {}],
      ["d", {}],
    ]);
    const saved = process.env.PATH;
    process.env.PATH = w.env.PATH;
    let r: Awaited<ReturnType<typeof runDoctorFix>>;
    try {
      r = await runDoctorFix(["a", "b", "c"], {
        table: tableFor(["a", "b", "c", "d"]),
        env: w.env,
      });
    } finally {
      process.env.PATH = saved;
    }
    expect(r.tools.map((t) => [t.tool, t.outcome])).toEqual([
      ["a", "applied"],
      ["b", "refused"],
      ["c", "not_run"],
    ]);
    expect(r.stopped_at).toBe("b");
    expect(w.read("a")).toContain("ARGV doctor --fix --apply");
    expect(w.read("b")).toContain("ARGV doctor --fix --apply");
    expect(w.read("c")).toBe("");
    expect(w.read("d")).toBe("");
    for (const n of ["a", "b"]) {
      const log = w.read(n);
      expect(log).not.toContain("SECRET_VALUE");
      expect(log).not.toContain("LOCUS_CONTROL_CAPABILITY");
      expect(log).toContain(`ENV LOCUS_HOME=${w.env.LOCUS_HOME}`);
    }
  });

  test("CLI: bare --apply refuses with the eligible tools; --json shape; plain --apply needs --ecosystem --fix", () => {
    const w = world([
      ["locus", {}],
      ["lexicon", {}],
      ["mdopener-mcp", {}],
    ]);
    const cli = (args: string[]) =>
      spawnSync(process.execPath, [CLI_ENTRY, "doctor", ...args], {
        cwd: w.bin,
        encoding: "utf8",
        env: {
          ...w.env,
          NO_COLOR: "1",
          STACK_NO_TELEMETRY: "1",
          STACK_TELEMETRY: "0",
          PATH: `${w.env.PATH}:${dirname(process.execPath)}`,
        },
      });
    const bare = cli(["--ecosystem", "--fix", "--apply"]);
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain(
      "--apply needs the tools to fix; eligible: lexicon, ashlr-md (e.g. --apply lexicon,ashlr-md); apply by hand: `locus doctor --fix --apply`",
    );
    expect(w.read("locus")).toBe("");

    const prev = cli(["--ecosystem", "--fix", "--json"]);
    expect(prev.status).toBe(0);
    const doc = JSON.parse(prev.stdout);
    expect(doc).toEqual({
      mode: "preview",
      tools: [
        ["locus", "locus"],
        ["lexicon", "lexicon"],
        ["ashlr-md", "mdopener-mcp"],
      ].map(([tool, command]) => ({
        tool,
        capability: "doctor-fix",
        command: `${command} doctor --fix --json`,
        preview: "2 fix(es) would be applied, 1 finding(s) to handle by hand",
        outcome: "previewed",
        ...(tool === "locus" ? { manual_apply: "locus doctor --fix --apply" } : {}),
      })),
      stopped_at: null,
    });
    for (const n of ["locus", "lexicon", "mdopener-mcp"])
      expect(w.read(n)).not.toContain("--apply");

    const prevText = cli(["--ecosystem", "--fix"]);
    expect(prevText.stdout).toContain(
      "To apply: stack doctor --ecosystem --fix --apply lexicon,ashlr-md",
    );
    expect(prevText.stdout).toContain("Run yourself: locus doctor --fix --apply");

    const applied = cli(["--ecosystem", "--fix", "--apply", "locus,lexicon", "--json"]);
    expect(applied.status).toBe(0);
    const out = JSON.parse(applied.stdout);
    expect(out.tools[0]).toMatchObject({
      tool: "locus",
      outcome: "manual",
      manual_apply: "locus doctor --fix --apply",
    });
    expect(out.tools[0].detail).toContain("never forwards");
    expect(out.tools[1].outcome).toBe("applied");
    expect(out.stopped_at).toBeNull();
    expect(w.read("locus")).not.toContain("--apply");
    expect(w.read("lexicon")).toContain("ARGV doctor --fix --apply");
    expect(`${applied.stdout}${applied.stderr}`).not.toContain("SECRET_VALUE");

    const human = cli(["--ecosystem", "--fix", "--apply", "locus"]);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("Run yourself: locus doctor --fix --apply");
    expect(w.read("locus")).not.toContain("--apply");

    const stray = cli(["--apply", "locus"]);
    expect(stray.status).toBe(1);
    expect(stray.stderr).toContain("--apply only works with --ecosystem --fix");
  });
});

test("locus apply is manual even with LOCUS_CONTROL_CAPABILITY in Stack's env, and it is never forwarded", async () => {
  const entries: EcosystemEntry[] = [
    { name: "locus", command: "locus", status: "ok", capabilities: ["doctor-fix"] },
  ];
  const calls: Array<[string, string[], Record<string, string>]> = [];
  const runner = async (command: string, argv: string[], env: Record<string, string>) => {
    calls.push([command, argv, env]);
    return { kind: "exited" as const, code: 0, stdout: "" };
  };
  const env = { PATH: "/b", LOCUS_HOME: "/l", LOCUS_CONTROL_CAPABILITY: "cap-should-not-pass" };
  const r = await runDoctorFix(["locus"], { entries, runner, env });
  expect(calls).toEqual([]);
  expect(r).toEqual({
    mode: "apply",
    stopped_at: null,
    tools: [
      {
        tool: "locus",
        capability: "doctor-fix",
        command: "locus doctor --fix --apply",
        preview: null,
        outcome: "manual",
        detail: LOCUS_MANUAL_APPLY_REASON,
        manual_apply: "locus doctor --fix --apply",
      },
    ],
  });
  await runDoctorFix(undefined, { entries, runner, env });
  expect(calls.map((c) => c[1])).toEqual([["doctor", "--fix", "--json"]]);
  expect(calls[0]?.[2]).not.toHaveProperty("LOCUS_CONTROL_CAPABILITY");
  expect(JSON.stringify(calls)).not.toContain("cap-should-not-pass");
});

test("FixUsageError is an Error", () => {
  expect(new FixUsageError("x")).toBeInstanceOf(Error);
});

describe("companion table", () => {
  test("locus, lexicon and ashlr-md (mdopener-mcp) with their documented argv", () => {
    expect(
      FIX_TOOLS.map((t) => [
        t.tool,
        t.command,
        t.capability,
        t.previewArgv,
        t.applyArgv,
        t.previewReadOnly,
      ]),
    ).toEqual([
      [
        "locus",
        "locus",
        "doctor-fix",
        ["doctor", "--fix", "--json"],
        ["doctor", "--fix", "--apply"],
        true,
      ],
      [
        "lexicon",
        "lexicon",
        "doctor-fix",
        ["doctor", "--fix", "--json"],
        ["doctor", "--fix", "--apply"],
        true,
      ],
      [
        "ashlr-md",
        "mdopener-mcp",
        "doctor-fix",
        ["doctor", "--fix", "--json"],
        ["doctor", "--fix", "--apply"],
        true,
      ],
    ]);
  });
  test("lexicon sees its store variables and nothing secret", () => {
    const lex = FIX_TOOLS.find((t) => t.tool === "lexicon") as FixTool;
    expect(
      fixEnv(lex, {
        PATH: "/b",
        LEXICON_PATH: "/x/l.json",
        XDG_CONFIG_HOME: "/c",
        LOCUS_HOME: "/l",
        ...SECRET_ENV,
      }),
    ).toEqual({ PATH: "/b", LEXICON_PATH: "/x/l.json", XDG_CONFIG_HOME: "/c", NO_COLOR: "1" });
  });
  test("exit 1 and exit 2 both stop the run; later tools are not run", async () => {
    const entries: EcosystemEntry[] = ["locus", "lexicon", "ashlr-md"].map((n) => ({
      name: n,
      command: n,
      status: "ok",
      capabilities: ["doctor-fix"],
    }));
    for (const code of [1, 2]) {
      const ran: string[] = [];
      const r = await runDoctorFix(["locus", "ashlr-md", "lexicon"], {
        entries,
        runner: async (command) => {
          ran.push(command);
          return { kind: "exited", code: command === "mdopener-mcp" ? code : 0, stdout: "" };
        },
      });
      // locus is never run for apply (manual); mdopener-mcp's failure stops lexicon.
      expect(ran).toEqual(["mdopener-mcp"]);
      expect(r.stopped_at).toBe("ashlr-md");
      expect(r.tools.map((t) => t.outcome)).toEqual(["manual", "refused", "not_run"]);
      if (code === 2) expect(r.tools[1]?.detail).toContain("usage error");
    }
  });
});
