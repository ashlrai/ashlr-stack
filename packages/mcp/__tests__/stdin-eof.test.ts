import { beforeAll, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

const packageDir = join(import.meta.dir, "..");

beforeAll(() => {
  // Always rebuild so the Node test exercises the current source.
  const build = spawnSync(process.execPath, ["run", "build"], {
    cwd: packageDir,
    stdio: "pipe",
  });
  expect(build.status).toBe(0);
}, 20_000);

for (const [runtime, command, args] of [
  ["Bun source", process.execPath, [join(packageDir, "src/server.ts")]],
  ["Node bundle", "node", [join(packageDir, "dist/server.js")]],
] as const) {
  test(`${runtime} exits cleanly without a response on immediate EOF`, async () => {
    const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const closed = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      child.stdin.end();
      const result = await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Server did not exit within 5s of immediate EOF")), 5_000);
        }),
      ]);
      expect(result).toEqual({ code: 0, signal: null });
      expect(stdout).toBe("");
      expect(stderr).toBe("");
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed;
    }
  }, 10_000);

  test(`${runtime} stays alive with open stdin and exits within 5s of EOF`, async () => {
    const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    // Consume output without logging anything inherited from the environment.
    child.stdout.resume();
    child.stderr.resume();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const alive = await Promise.race([
        exited.then(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(true), 2_000);
        }),
      ]);
      expect(alive).toBe(true);
      clearTimeout(timer);
      child.stdin.end();
      const result = await Promise.race([
        exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Server did not exit within 5s of stdin EOF")), 5_000);
        }),
      ]);
      expect(result).toEqual({ code: 0, signal: null });
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    }
  }, 10_000);
}
