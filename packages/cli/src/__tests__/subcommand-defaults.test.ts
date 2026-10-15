import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

function runCli(args: string[]) {
  const cwd = mkdtempSync(join(tmpdir(), "stack-subdefault-"));
  try {
    const r = spawnSync("bun", [CLI_ENTRY, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", STACK_NO_TELEMETRY: "1" },
    });
    return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? 0 };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("bare group commands run their default subcommand", () => {
  test("`stack templates` lists templates", () => {
    const r = runCli(["templates"]);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).not.toContain("No command specified");
    expect(r.stdout).toContain("nextjs-supabase-posthog");
  });

  test("`stack templates list` still lists once", () => {
    const r = runCli(["templates", "list"]);
    expect(r.code).toBe(0);
    expect(r.stdout.split("nextjs-supabase-posthog").length - 1).toBe(1);
  });

  test("`stack env` runs `stack env show`", () => {
    // May exit non-zero (no Phantom / no .stack.toml here); what matters is
    // that it dispatched to `show` instead of citty's "No command specified".
    const r = runCli(["env"]);
    expect(r.stdout + r.stderr).not.toContain("No command specified");
    expect(r.stdout).toContain("stack env show (dev)");
  });
});
