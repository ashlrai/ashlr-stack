import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// A made-up subcommand must fail the process. citty alone would print usage
// and exit 0 for an unmatched first argument, so this guards the exit code.
const entry = fileURLToPath(new URL("../packages/cli/src/index.ts", import.meta.url));

test.each(["definitely-not-a-stack-command", "命令-🚀", "unknown.command!?@"])(
  "unknown command %s exits non-zero with a plain message",
  (command) => {
    const home = mkdtempSync(join(tmpdir(), "stack-cli-unknown-"));
    try {
      const result = Bun.spawnSync([process.execPath, entry, command], {
        cwd: home,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 20_000,
        env: {
          HOME: home,
          PATH: process.env.PATH ?? "",
          NO_COLOR: "1",
          STACK_NO_UPDATE_CHECK: "1",
          STACK_TELEMETRY: "0",
          DO_NOT_TRACK: "1",
          CI: "1",
        },
      });

      const stderr = result.stderr.toString();
      expect(result.signalCode).toBeUndefined();
      expect(result.exitCode).toBe(1);
      // One plain line naming the command; no stack frames.
      expect(stderr).toBe(`[error] Unknown command \`${command}\`\n`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
  25_000,
);
