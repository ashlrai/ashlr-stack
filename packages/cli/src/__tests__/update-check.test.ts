/**
 * update-check tests
 *
 * Each integration test passes an explicit _cacheFile path inside a per-test
 * tmpdir, sidestepping the fact that os.homedir() is cached by Bun/Node and
 * ignores process.env.HOME changes at runtime.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkForUpdate, isNewer, shouldCheck } from "../lib/update-check.ts";

// ── per-test tmpdir ───────────────────────────────────────────────────────────

let tmpDir: string;
let cacheFilePath: string;
let origWrite: typeof process.stderr.write;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "update-check-test-"));
  cacheFilePath = join(tmpDir, "update-check.json");

  process.env.STACK_NO_UPDATE_CHECK = undefined;
  process.env.CI = undefined;

  origWrite = process.stderr.write.bind(process.stderr);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  process.stderr.write = origWrite;
  mock.restore();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function captureStderr(): () => string {
  const chunks: string[] = [];
  process.stderr.write = (chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    return origWrite(
      chunk as Parameters<typeof origWrite>[0],
      ...(rest as Parameters<typeof origWrite>[1][]),
    );
  };
  return () => chunks.join("");
}

function forceTTY(value: boolean) {
  Object.defineProperty(process.stderr, "isTTY", {
    value,
    configurable: true,
  });
}

function writeFreshCache(latest: string) {
  writeFileSync(cacheFilePath, JSON.stringify({ lastChecked: new Date().toISOString(), latest }));
}

function writeStaleCache(latest: string) {
  const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  writeFileSync(cacheFilePath, JSON.stringify({ lastChecked: staleDate, latest }));
}

// ── isNewer ───────────────────────────────────────────────────────────────────

describe("isNewer", () => {
  test("higher patch → true", () => expect(isNewer("0.1.0", "0.1.1")).toBe(true));
  test("higher minor → true", () => expect(isNewer("0.1.0", "0.2.0")).toBe(true));
  test("higher major → true", () => expect(isNewer("0.9.9", "1.0.0")).toBe(true));
  test("equal → false", () => expect(isNewer("1.2.3", "1.2.3")).toBe(false));
  test("remote older → false", () => expect(isNewer("1.2.3", "1.2.2")).toBe(false));
});

// ── shouldCheck ───────────────────────────────────────────────────────────────

describe("shouldCheck", () => {
  test("STACK_NO_UPDATE_CHECK=1 → false", () => {
    process.env.STACK_NO_UPDATE_CHECK = "1";
    expect(shouldCheck()).toBe(false);
  });

  test("CI=1 → false", () => {
    process.env.CI = "1";
    expect(shouldCheck()).toBe(false);
  });

  test("non-TTY stderr → false", () => {
    forceTTY(false);
    expect(shouldCheck()).toBe(false);
    forceTTY(true);
  });
});

// ── checkForUpdate ────────────────────────────────────────────────────────────

describe("checkForUpdate", () => {
  test("newer version available → banner printed to stderr", async () => {
    forceTTY(true);
    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ version: "0.2.0" }),
    })) as unknown as typeof fetch;

    const getOutput = captureStderr();
    await checkForUpdate("0.1.0", cacheFilePath);

    const out = getOutput();
    expect(out).toContain("0.1.0 → 0.2.0");
    expect(out).toContain("npm i -g @ashlr/stack");
  });

  test("same version → no banner", async () => {
    forceTTY(true);
    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ version: "0.1.0" }),
    })) as unknown as typeof fetch;

    const getOutput = captureStderr();
    await checkForUpdate("0.1.0", cacheFilePath);

    expect(getOutput()).not.toContain("available");
  });

  test("fresh cache (<24h) → fetch not called, banner shown from cache", async () => {
    forceTTY(true);
    writeFreshCache("0.2.0");

    const fetchMock = mock(async () => ({
      ok: true,
      json: async () => ({ version: "0.2.0" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const getOutput = captureStderr();
    await checkForUpdate("0.1.0", cacheFilePath);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getOutput()).toContain("0.1.0 → 0.2.0");
  });

  test("stale cache (>24h) → fetch called", async () => {
    forceTTY(true);
    writeStaleCache("0.1.0");

    const fetchMock = mock(async () => ({
      ok: true,
      json: async () => ({ version: "0.2.0" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await checkForUpdate("0.1.0", cacheFilePath);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("fetch throws → no error propagates", async () => {
    forceTTY(true);
    global.fetch = mock(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(checkForUpdate("0.1.0", cacheFilePath)).resolves.toBeUndefined();
  });

  test("STACK_NO_UPDATE_CHECK=1 → no-op, fetch never called", async () => {
    forceTTY(true);
    process.env.STACK_NO_UPDATE_CHECK = "1";

    const fetchMock = mock(async () => ({
      ok: true,
      json: async () => ({ version: "9.9.9" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const getOutput = captureStderr();
    await checkForUpdate("0.1.0", cacheFilePath);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getOutput()).not.toContain("available");
  });
});
