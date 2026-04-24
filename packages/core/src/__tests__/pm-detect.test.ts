import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync as mkdir, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPackageManager, installCommand } from "../pm-detect.ts";

function makeTmp(): string {
  const dir = join(tmpdir(), `pm-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("detectPackageManager", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmp();
    // Ensure there's a package.json so the walk stops here.
    writeFileSync(join(tmp, "package.json"), "{}");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("detects bun.lock → bun", async () => {
    writeFileSync(join(tmp, "bun.lock"), "");
    expect(await detectPackageManager(tmp)).toBe("bun");
  });

  it("detects bun.lockb → bun", async () => {
    writeFileSync(join(tmp, "bun.lockb"), "");
    expect(await detectPackageManager(tmp)).toBe("bun");
  });

  it("bun.lock takes precedence over pnpm-lock.yaml", async () => {
    writeFileSync(join(tmp, "bun.lock"), "");
    writeFileSync(join(tmp, "pnpm-lock.yaml"), "");
    expect(await detectPackageManager(tmp)).toBe("bun");
  });

  it("detects pnpm-lock.yaml → pnpm", async () => {
    writeFileSync(join(tmp, "pnpm-lock.yaml"), "");
    expect(await detectPackageManager(tmp)).toBe("pnpm");
  });

  it("detects yarn.lock → yarn", async () => {
    writeFileSync(join(tmp, "yarn.lock"), "");
    expect(await detectPackageManager(tmp)).toBe("yarn");
  });

  it("detects package-lock.json → npm", async () => {
    writeFileSync(join(tmp, "package-lock.json"), "");
    expect(await detectPackageManager(tmp)).toBe("npm");
  });

  it("no lockfile, has package.json → npm fallback", async () => {
    expect(await detectPackageManager(tmp)).toBe("npm");
  });

  it("no lockfile, no package.json → npm fallback", async () => {
    const empty = makeTmp();
    try {
      expect(await detectPackageManager(empty)).toBe("npm");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("walks up to parent dir to find lockfile", async () => {
    // Place lockfile in tmp (parent), start from a subdirectory with no lockfile.
    writeFileSync(join(tmp, "pnpm-lock.yaml"), "");
    const sub = join(tmp, "packages", "app");
    mkdirSync(sub, { recursive: true });
    // No package.json in sub — walk should continue up to tmp.
    expect(await detectPackageManager(sub)).toBe("pnpm");
  });
});

describe("installCommand", () => {
  it("bun returns bun add argv", () => {
    expect(installCommand("bun", ["@supabase/supabase-js"])).toEqual([
      "bun",
      "add",
      "@supabase/supabase-js",
    ]);
  });

  it("pnpm returns pnpm add argv", () => {
    expect(installCommand("pnpm", ["openai", "zod"])).toEqual(["pnpm", "add", "openai", "zod"]);
  });

  it("npm returns npm install argv", () => {
    expect(installCommand("npm", ["stripe"])).toEqual(["npm", "install", "stripe"]);
  });

  it("yarn returns yarn add argv", () => {
    expect(installCommand("yarn", ["@anthropic-ai/sdk"])).toEqual([
      "yarn",
      "add",
      "@anthropic-ai/sdk",
    ]);
  });

  it("handles multiple packages", () => {
    expect(installCommand("bun", ["mailgun.js", "form-data"])).toEqual([
      "bun",
      "add",
      "mailgun.js",
      "form-data",
    ]);
  });
});
