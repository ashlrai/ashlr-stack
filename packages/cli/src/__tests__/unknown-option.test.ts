import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

test("an unknown command reports usage without modifying the project", () => {
  const root = mkdtempSync(join(tmpdir(), "stack-unknown-command-"));
  const cwd = join(root, "project");
  const home = join(root, "home");
  try {
    mkdirSync(join(cwd, "nested"), { recursive: true });
    mkdirSync(home);
    writeFileSync(join(cwd, ".stack.toml"), '[project]\nname = "fixture"\n');
    writeFileSync(join(cwd, "nested", "sentinel.bin"), Buffer.from([0, 1, 127, 255]));
    const entriesBefore = readdirSync(cwd, { recursive: true }).sort();
    const configBefore = readFileSync(join(cwd, ".stack.toml"));
    const sentinelBefore = readFileSync(join(cwd, "nested", "sentinel.bin"));
    const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");
    const result = spawnSync("bun", [entry, "definitely-not-a-stack-command"], {
      cwd,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        NO_COLOR: "1",
        STACK_NO_UPDATE_CHECK: "1",
        STACK_TELEMETRY: "0",
      },
      timeout: 20_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command definitely-not-a-stack-command");
    expect(`${result.stdout}${result.stderr}`).toContain("USAGE stack");
    expect(`${result.stdout}${result.stderr}`).toContain(
      "Use stack <command> --help for more information about a command.",
    );
    expect(readdirSync(cwd, { recursive: true }).sort()).toEqual(entriesBefore);
    expect(readFileSync(join(cwd, ".stack.toml"))).toEqual(configBefore);
    expect(readFileSync(join(cwd, "nested", "sentinel.bin"))).toEqual(sentinelBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 25_000);
