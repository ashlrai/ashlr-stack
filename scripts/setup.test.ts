import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const root = resolve(import.meta.dir, "..");

function runSetup(env: NodeJS.ProcessEnv = process.env) {
  return spawnSync("bash", ["scripts/setup.sh"], {
    cwd: root,
    encoding: "utf8",
    env,
  });
}

describe("scripts/setup.sh", () => {
  test("rejects an operating system other than macOS or Linux", () => {
    const bin = mkdtempSync(join(tmpdir(), "stack-setup-uname-"));
    try {
      writeFileSync(
        join(bin, "uname"),
        '#!/bin/sh\nif [ "$1" = "-s" ]; then echo FreeBSD; exit 0; fi\nexec /usr/bin/uname "$@"\n',
      );
      chmodSync(join(bin, "uname"), 0o755);
      const result = runSetup({
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("macOS and Linux");
      expect(result.stderr).toContain("FreeBSD");
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  test("is idempotent and smoke-tests the provider catalog", () => {
    const first = runSetup();
    expect(first.status, first.stdout + first.stderr).toBe(0);
    expect(first.stdout).toContain(
      "setup: ready (stack providers --json, schema ashlr.stack.providers/v1).",
    );

    const second = runSetup();
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(second.stdout).toContain(
      "setup: ready (stack providers --json, schema ashlr.stack.providers/v1).",
    );
  }, 180_000);
});
