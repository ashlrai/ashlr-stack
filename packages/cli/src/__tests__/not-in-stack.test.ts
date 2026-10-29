import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { notInStackMessage } from "../lib/not-in-stack.ts";

/**
 * `stack remove <name>` and `stack open <name>` for a name that is not in
 * .stack.toml exit 1 and say what is configured, so an agent can retry with
 * a real name. `stack projects remove` only claims success when it removed
 * a registry entry.
 */

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) rmSync(created.pop() as string, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "stack-not-in-stack-"));
  created.push(d);
  return d;
}

function run(args: string[], cwd: string, registry: string) {
  const r = spawnSync("bun", [CLI_ENTRY, ...args], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, NO_COLOR: "1", CI: "1", STACK_REGISTRY_DIR: registry },
  });
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status ?? 0 };
}

function project(services: string[]): string {
  const d = tmp();
  const lines = ["[stack]", 'version = "1"', ""];
  for (const s of services) lines.push(`[services.${s}]`, `provider = "${s}"`, "secrets = []", "");
  writeFileSync(join(d, ".stack.toml"), lines.join("\n"));
  return d;
}

describe("notInStackMessage", () => {
  it("lists the configured services, sorted", () => {
    expect(notInStackMessage("nosuch", ["resend", "openai"])).toBe(
      "nosuch is not in this stack. Configured services: openai, resend.",
    );
  });

  it("suggests a case-insensitive match", () => {
    expect(notInStackMessage("OpenAI", ["openai"])).toContain("Did you mean openai?");
  });

  it("points at stack add when nothing is configured", () => {
    expect(notInStackMessage("openai", [])).toContain("no services yet");
    expect(notInStackMessage("openai", [])).toContain("stack add <provider>");
  });
});

describe("unknown service names", () => {
  for (const cmd of ["remove", "open"]) {
    it(`stack ${cmd} reports a missing stack and exits 1`, () => {
      const dir = tmp();
      const { out, code } = run([cmd, "nosuch"], dir, tmp());
      expect(code).toBe(1);
      expect(out).toContain(`No .stack.toml at ${join(realpathSync(dir), ".stack.toml")}.`);
      expect(out).toContain("Run `stack init` first.");
    });

    it(`stack ${cmd} names the configured services and exits 1`, () => {
      const dir = project(["openai"]);
      const { out, code } = run([cmd, "nosuch"], dir, tmp());
      expect(code).toBe(1);
      expect(out).toContain("nosuch is not in this stack. Configured services: openai.");
    });
  }
});

describe("stack projects remove", () => {
  it("exits 1 for a path that is not registered", () => {
    const registry = tmp();
    const { out, code } = run(["projects", "remove", join(tmp(), "nowhere")], tmp(), registry);
    expect(code).toBe(1);
    expect(out).toContain("No registered project matches");
    expect(out).not.toContain("Removed");
  });

  it("removes a project given as a relative path", () => {
    const registry = tmp();
    const dir = project([]);
    expect(run(["projects", "register"], dir, registry).code).toBe(0);
    const removed = run(["projects", "remove", "."], dir, registry);
    expect(removed.code).toBe(0);
    expect(removed.out).toContain("Removed . from registry.");
    expect(run(["projects", "list"], dir, registry).out).toContain("No projects registered yet");
  });
});
