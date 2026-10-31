import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
const projects: string[] = [];

afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true });
});

function snapshot(root: string, dir = root): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const name = relative(root, path);
    if (entry.isDirectory()) {
      entries[`${name}/`] = "directory";
      Object.assign(entries, snapshot(root, path));
    } else {
      entries[name] = readFileSync(path).toString("base64");
    }
  }
  return entries;
}

describe("stack scan malformed manifest", () => {
  test.each([
    ["human report", []],
    ["JSON report", ["--json"]],
    ["automatic mode", ["--auto"]],
    ["non-interactive automatic mode", ["--yes"]],
  ])(
    "rejects invalid JSON without changing the project in %s",
    (_mode, flags) => {
      for (const existingConfig of [false, true]) {
        const project = mkdtempSync(join(tmpdir(), "stack scan malformed "));
        projects.push(project);
        mkdirSync(join(project, "nested"));
        writeFileSync(join(project, "package.json"), '{"dependencies": {"openai": "^4",}}\n');
        writeFileSync(join(project, "fly.toml"), 'app = "example"\n');
        writeFileSync(join(project, "nested", "keep.txt"), "unchanged\n");
        if (existingConfig) {
          writeFileSync(join(project, ".stack.toml"), '[project]\nname = "example"\n');
          writeFileSync(join(project, ".stack.local.toml"), "# existing local configuration\n");
        }
        const before = snapshot(project);
        const result = spawnSync("bun", [cli, "scan", ...flags, "--path", project], {
          encoding: "utf8",
          timeout: 10_000,
          env: { ...process.env, CI: "1", NO_COLOR: "1" },
        });

        expect(result.status).toBe(1);
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
        expect(output).toContain("Invalid JSON in dependency manifest");
        expect(output).toContain(join(project, "package.json"));
        expect(output).toContain("Fix it and retry the scan");
        expect(output).not.toContain("provider(s) detected");
        expect(output).not.toContain("No providers detected");
        expect(output).not.toContain("scan complete");
        if (flags.includes("--json")) {
          expect(result.stdout).toBe("");
          expect(result.stderr).toContain("Invalid JSON");
        }
        expect(snapshot(project)).toEqual(before);
      }
    },
    30_000,
  );
});
