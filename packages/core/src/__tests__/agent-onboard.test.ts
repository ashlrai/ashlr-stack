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
