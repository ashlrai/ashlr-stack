import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CLI = join(import.meta.dir, "..", "..", "..", "cli", "src", "index.ts");

describe("stack completion", () => {
  test("zsh output is a loadable compdef script", () => {
    const res = spawnSync("bun", ["run", CLI, "completion", "zsh"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^#compdef stack/);
    expect(res.stdout).toContain("_stack()");
    expect(res.stdout).toContain('"supabase"');
  });

  test("bash output registers complete -F", () => {
    const res = spawnSync("bun", ["run", CLI, "completion", "bash"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("_stack_completion()");
    expect(res.stdout).toContain("complete -F _stack_completion stack");
  });

  test("fish output registers complete commands", () => {
    const res = spawnSync("bun", ["run", CLI, "completion", "fish"], { encoding: "utf-8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("complete -c stack");
  });

  test("unknown shell exits non-zero", () => {
    const res = spawnSync("bun", ["run", CLI, "completion", "powershell"], { encoding: "utf-8" });
    expect(res.status).not.toBe(0);
  });
});

describe("stack ci init", () => {
  test("writes a valid-looking workflow under .github/workflows/", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "stack-ci-"));
    const registryDir = mkdtempSync(join(tmpdir(), "stack-ci-reg-"));

    // Seed a minimal .stack.toml so `ci init` is happy.
    const { emptyConfig, writeConfig } = await import("../config.ts");
    const prev = process.env.STACK_REGISTRY_DIR;
    process.env.STACK_REGISTRY_DIR = registryDir;
    await writeConfig(emptyConfig(), cwd);

    const res = spawnSync("bun", ["run", CLI, "ci", "init"], { encoding: "utf-8", cwd });
    expect(res.status).toBe(0);

    const workflowPath = join(cwd, ".github", "workflows", "stack-ci.yml");
    expect(existsSync(workflowPath)).toBe(true);
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("name: Stack doctor");
    expect(content).toContain("stack doctor --json");
    expect(content).toContain("PHANTOM_CLOUD_TOKEN");
    expect(content).toContain("actions/upload-artifact@v4");

    if (prev === undefined) delete process.env.STACK_REGISTRY_DIR;
    else process.env.STACK_REGISTRY_DIR = prev;
  });
});
