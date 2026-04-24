import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

function runCompletion(shell: string): { stdout: string; stderr: string; code: number } {
  const result = spawnSync("bun", [CLI_ENTRY, "completion", shell], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 0,
  };
}

// All subcommands that must appear in every shell's completion output.
const REQUIRED_COMMANDS = [
  "init",
  "import",
  "scan",
  "clone",
  "add",
  "remove",
  "list",
  "info",
  "status",
  "env",
  "deps",
  "doctor",
  "exec",
  "sync",
  "open",
  "login",
  "templates",
  "providers",
  "recommend",
  "apply",
  "swap",
  "telemetry",
  "projects",
  "upgrade",
  "ci",
  "completion",
];

// Key flags that must appear in every shell's output (without leading --)
const REQUIRED_FLAGS = [
  "noRollback",
  "noProvision",
  "yes",
  "json",
  "confidence",
  "install",
  "allOrphans",
  "reconcile",
  "dryRun",
];

// Enumerable flag values that must appear for fish/bash/zsh
const REQUIRED_FLAG_VALUES = ["low", "medium", "high", "ask", "always", "never"];

for (const shell of ["bash", "zsh", "fish"] as const) {
  describe(`stack completion ${shell}`, () => {
    it("exits 0 and emits a non-empty script", () => {
      const { stdout, code } = runCompletion(shell);
      expect(code).toBe(0);
      expect(stdout.length).toBeGreaterThan(100);
    });

    it("contains all required subcommands", () => {
      const { stdout } = runCompletion(shell);
      for (const cmd of REQUIRED_COMMANDS) {
        expect(stdout).toContain(cmd);
      }
    });

    it("contains swap and telemetry (newly added)", () => {
      const { stdout } = runCompletion(shell);
      expect(stdout).toContain("swap");
      expect(stdout).toContain("telemetry");
    });

    it("contains key flags", () => {
      const { stdout } = runCompletion(shell);
      for (const flag of REQUIRED_FLAGS) {
        expect(stdout).toContain(flag);
      }
    });

    it("contains enumerable flag values for --confidence and --install", () => {
      const { stdout } = runCompletion(shell);
      for (const val of REQUIRED_FLAG_VALUES) {
        expect(stdout).toContain(val);
      }
    });
  });
}

describe("stack completion — shell-specific structure", () => {
  it("bash: starts with _stack_completion function and registers with complete", () => {
    const { stdout } = runCompletion("bash");
    expect(stdout).toContain("_stack_completion()");
    expect(stdout).toContain("complete -F _stack_completion stack");
  });

  it("zsh: starts with #compdef stack and defines _stack function", () => {
    const { stdout } = runCompletion("zsh");
    expect(stdout.trimStart()).toMatch(/^#compdef stack/);
    expect(stdout).toContain("_stack()");
  });

  it("fish: uses complete -c stack lines", () => {
    const { stdout } = runCompletion("fish");
    expect(stdout).toContain("complete -c stack");
    expect(stdout).toContain("__fish_use_subcommand");
  });

  it("rejects unknown shell with non-zero exit", () => {
    const { code, stderr } = runCompletion("powershell");
    expect(code).toBeGreaterThan(0);
    expect(stderr).toContain("Unsupported shell");
  });
});

describe("stack completion zsh — telemetry subcommands", () => {
  it("contains enable/disable/status for telemetry", () => {
    const { stdout } = runCompletion("zsh");
    expect(stdout).toContain("enable");
    expect(stdout).toContain("disable");
    // 'status' is also used by other contexts but it appears from telemetry
    expect(stdout).toContain("status");
  });
});

describe("stack completion bash — swap flags", () => {
  it("contains noRollback and keepFrom for swap", () => {
    const { stdout } = runCompletion("bash");
    expect(stdout).toContain("noRollback");
    expect(stdout).toContain("keepFrom");
  });
});
