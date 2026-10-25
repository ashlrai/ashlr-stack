import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expectRefusal,
  parseExecArgv,
  parseWhoami,
  probeEnv,
  readPinnedAlias,
} from "../lib/locus-identity.ts";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const REFS = ["env:", "phm:", "phm_", "keychain:", "credential_ref", "SECRET_VALUE"];

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

/** Shape emitted by locus-core `Whoami` (crates/locus-core/src/store.rs). */
function whoami(over: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      session_id: "s1",
      binding_alias: "acme",
      binding_id: "b1",
      tenant: "acme-co",
      principal: null,
      providers: [{ provider: "openai", credential: { source: "env:OPENAI_KEY" } }],
      expires_at: "2026-10-25T20:00:00Z",
      expires_in_secs: 3600,
      seal_ok: true,
      frozen: false,
      ...over,
    },
    null,
    2,
  );
}

describe("parseWhoami accepts only confirmed fields", () => {
  test("a sealed, unfrozen pin reports its alias", () => {
    expect(parseWhoami(whoami())).toEqual({ kind: "pinned", alias: "acme" });
  });
  test("frozen or a bad seal is refused as frozen", () => {
    expect(parseWhoami(whoami({ frozen: true })).kind).toBe("frozen");
    expect(parseWhoami(whoami({ seal_ok: false })).kind).toBe("frozen");
  });
  test("missing or mistyped fields are unreadable", () => {
    for (const bad of [
      whoami({ frozen: undefined }),
      whoami({ seal_ok: "true" }),
      whoami({ binding_alias: 7 }),
      whoami({ binding_alias: "a b;rm" }),
      "[]",
      "null",
      "not json",
      "",
    ]) {
      expect(parseWhoami(bad).kind).toBe("unreadable");
    }
  });
});

describe("readPinnedAlias probe", () => {
  test("passes only the minimal env, never secrets", () => {
    let seen: Record<string, string> = {};
    readPinnedAlias(
      (env) => {
        seen = env;
        return { status: 0, stdout: whoami() };
      },
      {
        PATH: "/bin",
        HOME: "/h",
        LANG: "C",
        TMPDIR: "/t",
        LOCUS_HOME: "/l",
        OPENAI_API_KEY: "sk-x",
        GITHUB_TOKEN: "ghp",
        LOCUS_CONTROL_CAPABILITY: "cap",
        PHANTOM_TOKEN: "phm_x",
      },
    );
    expect(Object.keys(seen).sort()).toEqual(["HOME", "LANG", "LOCUS_HOME", "PATH", "TMPDIR"]);
    expect(probeEnv({ USERPROFILE: "C:\\u", AWS_SECRET_ACCESS_KEY: "x" })).toEqual({
      USERPROFILE: "C:\\u",
    });
  });
  test("non-zero exit is no pin; ENOENT is not installed; other errors and oversize are unreadable", () => {
    expect(readPinnedAlias(() => ({ status: 1, stdout: "" })).kind).toBe("no_pin");
    expect(
      readPinnedAlias(() => ({ status: null, stdout: "", error: { code: "ENOENT" } })).kind,
    ).toBe("not_installed");
    expect(
      readPinnedAlias(() => ({ status: null, stdout: "", error: { code: "ETIMEDOUT" } })).kind,
    ).toBe("unreadable");
    expect(readPinnedAlias(() => ({ status: 0, stdout: " ".repeat(70_000) })).kind).toBe(
      "unreadable",
    );
    expect(
      readPinnedAlias(() => {
        throw new Error("boom");
      }).kind,
    ).toBe("unreadable");
  });
});

describe("expectRefusal", () => {
  test("match passes; every other case refuses with a locus enter hint", () => {
    expect(expectRefusal("acme", { kind: "pinned", alias: "acme" })).toBeNull();
    const mis = expectRefusal("acme", { kind: "pinned", alias: "personal" }) as string;
    expect(mis).toStartWith("pin_mismatch:");
    expect(mis).toContain("'personal' is pinned");
    expect(mis).toContain("locus enter acme");
    for (const k of ["no_pin", "not_installed", "unreadable"] as const) {
      expect(expectRefusal("acme", { kind: k }) as string).toContain("locus enter acme");
    }
    expect(expectRefusal("acme", { kind: "frozen", alias: "acme" }) as string).toStartWith(
      "pin_frozen:",
    );
  });
  test("junk input is never echoed", () => {
    const junk = "$(touch pwned)\u001b[31m";
    const msg = expectRefusal(junk, { kind: "pinned", alias: "acme" }) as string;
    expect(msg).not.toContain("touch");
    expect(msg).not.toContain("\u001b");
  });
});

describe("parseExecArgv", () => {
  test("reads --as only before --", () => {
    expect(parseExecArgv(["--as", "acme", "--", "echo", "--as", "x"])).toEqual({
      ok: true,
      as: "acme",
      forwarded: ["echo", "--as", "x"],
    });
    expect(parseExecArgv(["--as=acme", "--", "true"])).toEqual({
      ok: true,
      as: "acme",
      forwarded: ["true"],
    });
    expect(parseExecArgv(["--", "true"])).toEqual({ ok: true, forwarded: ["true"] });
  });
  test("--as without -- or without a value is a usage error", () => {
    expect(parseExecArgv(["--as", "acme", "true"]).ok).toBe(false);
    expect(parseExecArgv(["--as"]).ok).toBe(false);
    expect(parseExecArgv(["--as=", "--", "true"]).ok).toBe(false);
  });
});

// End to end with fake `locus` and `phantom` shell scripts. Skipped on
// Windows: the fakes are POSIX sh scripts, and the probe deliberately spawns
// `locus` without a shell, which cannot run a .cmd shim there. The logic
// above is covered on every platform through the injected runner.
describe.skipIf(process.platform === "win32")("stack exec --as end to end", () => {
  function setup(locusScript: string | null) {
    const cwd = tmp("stack-exec-as-");
    writeFileSync(join(cwd, ".stack.toml"), '[stack]\nversion = "1"\n');
    const bin = tmp("stack-exec-as-bin-");
    const phantomRan = join(cwd, "phantom-ran");
    const envDump = join(cwd, "locus-env");
    writeFileSync(
      join(bin, "phantom"),
      `#!/bin/sh
case "$1" in
  --version) echo "phantom fake 0.0.1" ;;
  exec) touch ${JSON.stringify(phantomRan)}; shift; [ "$1" = "--" ] && shift; exec "$@" ;;
  *) exit 0 ;;
esac
`,
    );
    chmodSync(join(bin, "phantom"), 0o755);
    if (locusScript !== null) {
      writeFileSync(
        join(bin, "locus"),
        `#!/bin/sh\nenv > ${JSON.stringify(envDump)}\n${locusScript}\n`,
      );
      chmodSync(join(bin, "locus"), 0o755);
    }
    return { cwd, bin, phantomRan, envDump, marker: join(cwd, "child-ran") };
  }
  function run(s: ReturnType<typeof setup>, asArgs: string[]) {
    const r = spawnSync(
      process.execPath,
      [CLI_ENTRY, "exec", ...asArgs, "--", "sh", "-c", `touch ${s.marker}`],
      {
        cwd: s.cwd,
        encoding: "utf8",
        env: {
          HOME: s.cwd,
          NO_COLOR: "1",
          STACK_NO_TELEMETRY: "1",
          STACK_TELEMETRY: "0",
          OPENAI_API_KEY: "SECRET_VALUE",
          PATH: `${s.bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        },
      },
    );
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    for (const ref of REFS) expect(out).not.toContain(ref);
    return { code: r.status, out };
  }
  const okWhoami = `cat <<'J'\n${whoami()}\nJ`;

  test("match runs the command", () => {
    const s = setup(okWhoami);
    const r = run(s, ["--as", "acme"]);
    expect(r.code).toBe(0);
    expect(existsSync(s.marker)).toBe(true);
    const env = readFileSync(s.envDump, "utf8");
    expect(env).not.toContain("SECRET_VALUE");
  });
  test("mismatch refuses before phantom or the command starts", () => {
    const s = setup(okWhoami);
    const r = run(s, ["--as=personal"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("pin_mismatch:");
    expect(r.out).toContain("locus enter personal");
    expect(existsSync(s.marker)).toBe(false);
    expect(existsSync(s.phantomRan)).toBe(false);
  });
  test("no pin, frozen, garbage, missing locus and junk input all refuse", () => {
    const cases: [string | null, string[], string][] = [
      ["echo 'no active session' >&2; exit 1", ["--as", "acme"], "pin_missing:"],
      [`cat <<'J'\n${whoami({ frozen: true })}\nJ`, ["--as", "acme"], "pin_frozen:"],
      ['echo \'{"alias":"acme"}\'', ["--as", "acme"], "pin_unknown:"],
      [null, ["--as", "acme"], "locus_missing:"],
      [okWhoami, ["--as", "a;b$(x)"], "--as needs a Locus binding alias"],
    ];
    for (const [script, args, expected] of cases) {
      const s = setup(script);
      const r = run(s, args);
      expect(r.code).toBe(1);
      expect(r.out).toContain(expected);
      expect(r.out).not.toContain("$(x)");
      expect(existsSync(s.marker)).toBe(false);
      expect(existsSync(s.phantomRan)).toBe(false);
    }
  });
});
