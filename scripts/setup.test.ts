import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { noticeFor } from "../packages/plugin/hooks/session-start.mjs";
import { bunInstallArgv, supportedPlatform } from "./setup.mjs";

const root = resolve(import.meta.dir, "..");

function runSetup(entry: string) {
  return spawnSync(entry === "node" ? "node" : "bash", entry === "node" ? ["scripts/setup.mjs"] : ["scripts/setup.sh"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
}

describe("scripts/setup.mjs", () => {
  test("accepts macOS, Windows, and Linux only", () => {
    expect(supportedPlatform("darwin")).toBe(true);
    expect(supportedPlatform("linux")).toBe(true);
    expect(supportedPlatform("win32")).toBe(true);
    expect(supportedPlatform("freebsd")).toBe(false);
  });

  test("installs Bun with the Windows PowerShell one-liner or the Unix curl script", () => {
    expect(bunInstallArgv("win32")).toEqual({
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "irm https://bun.sh/install.ps1 | iex",
      ],
    });
    expect(bunInstallArgv("linux").command).toBe("bash");
    expect(bunInstallArgv("darwin").args.join(" ")).toContain("curl -fsSL https://bun.sh/install | bash");
  });

  test("shell entry and node entry are idempotent and smoke-test the catalog", () => {
    for (const entry of ["node", "bash"] as const) {
      const result = runSetup(entry);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain(
        "setup: ready (stack providers --json, schema ashlr.stack.providers/v1).",
      );
    }
  }, 180_000);

  test("contributor shell scripts use LF, and the Windows bash shim template does too", () => {
    for (const path of ["scripts/setup.sh", "scripts/fast-check.sh", "scripts/setup.mjs"]) {
      expect(readFileSync(join(root, path), "utf8")).not.toContain("\r");
    }
    const installer = readFileSync(join(root, "scripts/install.ps1"), "utf8");
    expect(installer).toContain("#!/usr/bin/env bash`n");
    expect(installer).not.toContain("#!/usr/bin/env bash`r`n");
  });
});

describe("session start notice", () => {
  test("counts service sections in a CRLF stack file", () => {
    const text = "[stack]\r\nversion = \"1\"\r\n\r\n[services.openai]\r\nprovider = \"openai\"\r\n";
    expect(noticeFor(text)).toContain("(1 services)");
  });
});
