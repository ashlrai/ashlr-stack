import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyOnboarding,
  configPathFor,
  planOnboarding,
  undoOnboarding,
} from "../agent-onboard.ts";

let home: string;
let emptyBin: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "stack-onboard-"));
  emptyBin = join(home, "empty-bin");
  mkdirSync(emptyBin);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const opts = () => ({ home, pathEnv: emptyBin });

function tree(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const f = join(d, n);
      const st = readdirSyncSafe(f);
      if (st) walk(f);
      else out.push(`${f.slice(dir.length)}:${readFileSync(f, "utf-8")}`);
    }
  };
  walk(dir);
  return out.join("\n");
}
function readdirSyncSafe(p: string): boolean {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

describe("planOnboarding", () => {
  it("reports every client not-detected on a clean home and writes nothing", () => {
    const before = tree(home);
    const plan = planOnboarding(opts());
    expect(plan.map((p) => [p.client, p.state, p.willWrite])).toEqual([
      ["claude", "not-detected", false],
      ["codex", "not-detected", false],
      ["cursor", "not-detected", false],
      ["gemini", "not-detected", false],
    ]);
    expect(tree(home)).toBe(before);
  });

  it("detects by config directory and by binary on PATH", () => {
    mkdirSync(join(home, ".gemini"));
    writeFileSync(join(emptyBin, "codex"), "#!/bin/sh\n");
    const plan = planOnboarding(opts());
    const by = Object.fromEntries(plan.map((p) => [p.client, p]));
    expect(by.gemini?.detected).toBe(true);
    expect(by.gemini?.state).toBe("not-wired");
    expect(by.codex?.detected).toBe(true);
    expect(by.cursor?.detected).toBe(false);
  });

  it("classifies wired, differs and error without touching files", () => {
    mkdirSync(join(home, ".cursor"));
    mkdirSync(join(home, ".gemini"));
    writeFileSync(
      configPathFor("cursor", home),
      JSON.stringify({ mcpServers: { "ashlr-hub": { command: "ashlr", args: ["mcp"] } } }),
    );
    writeFileSync(
      configPathFor("gemini", home),
      JSON.stringify({ mcpServers: { "ashlr-hub": { command: "other", args: ["mcp"] } } }),
    );
    mkdirSync(join(home, ".codex"));
    writeFileSync(
      configPathFor("codex", home),
      '[mcp_servers.ashlr-hub]\ncommand = "ashlr"\nargs = ["mcp"]\n',
    );
    writeFileSync(join(home, ".claude.json"), "{ not json");
    const by = Object.fromEntries(planOnboarding(opts()).map((p) => [p.client, p]));
    expect(by.cursor?.state).toBe("wired");
    expect(by.gemini?.state).toBe("differs");
    expect(by.gemini?.willWrite).toBe(false);
    expect(by.codex?.state).toBe("wired");
    expect(by.claude?.state).toBe("error");
    expect(by.claude?.willWrite).toBe(false);
  });
});

describe("applyOnboarding and undoOnboarding", () => {
  function seed() {
    mkdirSync(join(home, ".cursor"));
    mkdirSync(join(home, ".gemini"));
    mkdirSync(join(home, ".codex"));
    mkdirSync(join(home, ".claude"));
    writeFileSync(
      configPathFor("cursor", home),
      `${JSON.stringify({ mcpServers: { other: { command: "x" } } }, null, 4)}\n`,
    );
    writeFileSync(
      configPathFor("codex", home),
      'model = "x"\n\n[mcp_servers.other]\ncommand = "y"\n',
    );
    // gemini settings with unrelated keys; claude has no config file at all
    writeFileSync(configPathFor("gemini", home), JSON.stringify({ theme: "dark" }));
  }

  it("takes all detected clients from not wired to wired, then undo restores byte for byte", async () => {
    seed();
    const res = await applyOnboarding(opts());
    expect(res.written.map((w) => w.client).sort()).toEqual([
      "claude",
      "codex",
      "cursor",
      "gemini",
    ]);
    expect(res.verified.every((p) => p.state === "wired")).toBe(true);

    const cursor = JSON.parse(readFileSync(configPathFor("cursor", home), "utf-8"));
    expect(cursor.mcpServers.other).toEqual({ command: "x" });
    expect(cursor.mcpServers["ashlr-hub"]).toEqual({ command: "ashlr", args: ["mcp"] });
    const gemini = JSON.parse(readFileSync(configPathFor("gemini", home), "utf-8"));
    expect(gemini.theme).toBe("dark");
    const claude = JSON.parse(readFileSync(join(home, ".claude.json"), "utf-8"));
    expect(claude.mcpServers["ashlr-hub"]).toEqual({
      type: "stdio",
      command: "ashlr",
      args: ["mcp"],
      env: {},
    });
    const toml = readFileSync(configPathFor("codex", home), "utf-8");
    expect(toml).toContain('model = "x"');
    expect(toml).toContain("[mcp_servers.other]");
    expect(toml).toContain('[mcp_servers.ashlr-hub]\ncommand = "ashlr"\nargs = ["mcp"]');

    // idempotent: a second apply writes nothing
    const again = await applyOnboarding(opts());
    expect(again.written).toEqual([]);

    const undo = await undoOnboarding({ home });
    expect(undo.refused).toEqual([]);
    expect(undo.restored).toHaveLength(4);
    // claude config did not exist before, so undo removes it; backups and manifest remain/clean
    expect(existsSync(join(home, ".claude.json"))).toBe(false);
    for (const c of ["cursor", "codex", "gemini"] as const) {
      expect(readFileSync(configPathFor(c, home), "utf-8")).toBe(
        c === "cursor"
          ? `${JSON.stringify({ mcpServers: { other: { command: "x" } } }, null, 4)}\n`
          : c === "codex"
            ? 'model = "x"\n\n[mcp_servers.other]\ncommand = "y"\n'
            : JSON.stringify({ theme: "dark" }),
      );
    }
    expect(existsSync(join(home, ".ashlr-stack", "onboard-manifest.json"))).toBe(false);
  });

  it("never overwrites a differing entry", async () => {
    mkdirSync(join(home, ".cursor"));
    const differing = JSON.stringify({
      mcpServers: { "ashlr-hub": { command: "custom", args: [] } },
    });
    writeFileSync(configPathFor("cursor", home), differing);
    const res = await applyOnboarding({ ...opts(), clients: ["cursor"] });
    expect(res.written).toEqual([]);
    expect(readFileSync(configPathFor("cursor", home), "utf-8")).toBe(differing);
    expect(res.verified[0]?.state).toBe("differs");
  });

  it("refuses to undo a file that changed after onboarding", async () => {
    mkdirSync(join(home, ".cursor"));
    writeFileSync(configPathFor("cursor", home), "{}");
    await applyOnboarding({ ...opts(), clients: ["cursor"] });
    const edited = `${readFileSync(configPathFor("cursor", home), "utf-8")}\n`;
    writeFileSync(configPathFor("cursor", home), edited);
    const undo = await undoOnboarding({ home });
    expect(undo.restored).toEqual([]);
    expect(undo.refused[0]?.reason).toContain("changed");
    expect(readFileSync(configPathFor("cursor", home), "utf-8")).toBe(edited);
  });

  it("errors on undo with no manifest", async () => {
    await expect(undoOnboarding({ home })).rejects.toThrow("nothing to undo");
  });

  it("skips undetected clients unless includeUndetected is set", async () => {
    const res = await applyOnboarding({ ...opts(), clients: ["gemini"] });
    expect(res.written).toEqual([]);
    expect(existsSync(configPathFor("gemini", home))).toBe(false);
    const forced = await applyOnboarding({
      ...opts(),
      clients: ["gemini"],
      includeUndetected: true,
    });
    expect(forced.written).toHaveLength(1);
    expect(existsSync(configPathFor("gemini", home))).toBe(true);
  });

  it("does not put secret-looking values into the gateway entry", async () => {
    mkdirSync(join(home, ".gemini"));
    await applyOnboarding({ ...opts(), clients: ["gemini"] });
    expect(readFileSync(configPathFor("gemini", home), "utf-8")).not.toMatch(/key|token|secret/i);
  });
});

it.each(["null", "[]", "42", '{"mcpServers":null}', '{"mcpServers":42}', "{broken"])(
  "refuses malformed JSON config %s without writing",
  async (raw) => {
    const path = configPathFor("claude", home);
    writeFileSync(path, raw);
    const result = await applyOnboarding({ ...opts(), clients: ["claude"] });
    expect(result.written).toEqual([]);
    expect(result.manifestPath).toBeNull();
    expect(result.skipped[0]?.state).toBe("error");
    expect(result.skipped[0]?.error).toBeTruthy();
    expect(readFileSync(path, "utf-8")).toBe(raw);
  },
);

it.each([
  ["", "not-wired"],
  ['[mcp_servers.other]\ncommand = "ashlr"', "not-wired"],
  [
    '[mcp_servers."ashlr-hub"] # gateway\r\ncommand = "ashlr" # command\r\nargs = ["mcp"]\r\n[other]\r\ncommand = "different"',
    "wired",
  ],
  ['[mcp_servers.ashlr-hub]\ncommand = "ashlr"\nargs = []', "differs"],
  ['[mcp_servers.ashlr-hub]\nargs = ["mcp"]', "differs"],
] as const)("inspects TOML %s", (raw, state) => {
  const path = configPathFor("codex", home);
  mkdirSync(join(home, ".codex"));
  writeFileSync(path, raw);
  expect(planOnboarding({ ...opts(), clients: ["codex"] })[0]?.state).toBe(state);
  expect(readFileSync(path, "utf-8")).toBe(raw);
});

it.each(["missing config", "missing backup"])(
  "undo retains manifest for %s and permits retry",
  async (mode) => {
    const path = configPathFor("claude", home);
    writeFileSync(path, "{}");
    const applied = await applyOnboarding({
      ...opts(),
      clients: ["claude"],
      includeUndetected: true,
    });
    const entry = applied.written[0]!;
    const target = mode === "missing config" ? path : entry.backupPath!;
    const original = readFileSync(target, "utf-8");
    rmSync(target);
    const result = await undoOnboarding({ home });
    expect(result.restored).toEqual([]);
    expect(result.refused).toEqual([
      {
        entry,
        reason:
          mode === "missing config" ? "config file no longer exists" : "backup file is missing",
      },
    ]);
    expect(JSON.parse(readFileSync(applied.manifestPath!, "utf-8")).entries).toEqual([entry]);
    writeFileSync(target, original);
    expect((await undoOnboarding({ home })).restored).toEqual([entry]);
    expect(readFileSync(path, "utf-8")).toBe("{}");
    expect(existsSync(applied.manifestPath!)).toBe(false);
  },
);
