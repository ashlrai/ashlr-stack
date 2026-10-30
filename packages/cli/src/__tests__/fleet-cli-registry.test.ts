import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../index.ts", import.meta.url));
const commands = ["fleet-act", "fleet-stream", "fleet-graph", "fleet-bets", "fleet-lanes"];

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      NO_COLOR: "1",
      STACK_NO_UPDATE_CHECK: "1",
      STACK_TELEMETRY: "0",
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return result.stdout;
}

test("root help registers every fleet command", () => {
  const help = cli("--help");
  for (const command of commands) expect(help).toMatch(new RegExp(`\\b${command}\\b`));
});

for (const command of commands) {
  test(`${command} resolves its own help and flags`, () => {
    const help = cli(command, "--help");
    expect(help).toContain(command);
    for (const flag of command === "fleet-act"
      ? ["--apply", "--lane", "--job"]
      : command === "fleet-stream"
        ? ["--dispatch", "--jobs", "--follow", "--sse", "--port"]
        : command === "fleet-bets"
          ? ["--json", "--queue", "--router", "--ready", "--metrics", "--src"]
          : command === "fleet-lanes"
            ? ["--json", "--queue"]
            : ["--json", "--queue", "--router"])
      expect(help).toContain(flag);
  });
}

for (const shell of ["bash", "zsh", "fish"]) {
  test(`${shell} completes every fleet command and the new flags`, () => {
    const script = cli("completion", shell);
    for (const command of [...commands, "fleet", "fleet-latency"])
      expect(script).toContain(command);
    for (const flag of ["dispatch", "jobs", "follow", "sse", "port", "router", "apply"])
      expect(script).toContain(shell === "fish" ? `-l "${flag}"` : `--${flag}`);
  });
}
