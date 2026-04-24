/**
 * Telemetry module tests.
 *
 * Strategy: use __setConfigDirForTesting() to redirect all config I/O to a
 * temp directory, bypassing the real ~/.ashlr/stack/config.json entirely.
 * Tests write/delete the temp config file directly between runs.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  __setConfigDirForTesting,
  disable as disableTelemetry,
  emit,
  enable as enableTelemetry,
  isEnabled,
} from "../telemetry.ts";

// ---------------------------------------------------------------------------
// Temp config dir wired before any test runs
// ---------------------------------------------------------------------------

const TMP_CONFIG_DIR = join(import.meta.dir, "__telemetry_tmp__", ".ashlr", "stack");
const TMP_CONFIG_PATH = join(TMP_CONFIG_DIR, "config.json");

async function writeCfg(cfg: object): Promise<void> {
  await mkdir(TMP_CONFIG_DIR, { recursive: true });
  await writeFile(TMP_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

async function deleteCfg(): Promise<void> {
  await rm(TMP_CONFIG_PATH, { force: true });
}

let realFetch: typeof fetch;

beforeAll(async () => {
  await mkdir(TMP_CONFIG_DIR, { recursive: true });
  __setConfigDirForTesting(TMP_CONFIG_DIR);
  realFetch = globalThis.fetch;
});

afterAll(async () => {
  __setConfigDirForTesting(undefined);
  globalThis.fetch = realFetch;
  await rm(join(import.meta.dir, "__telemetry_tmp__"), { recursive: true, force: true });
});

beforeEach(async () => {
  await deleteCfg();
  globalThis.fetch = realFetch;
  process.env.STACK_TELEMETRY = undefined;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.STACK_TELEMETRY = undefined;
});

// ---------------------------------------------------------------------------
// 1. emit when disabled is a no-op (fetch never called)
// ---------------------------------------------------------------------------

describe("emit when disabled", () => {
  test("fetch is never called when config.enabled = false", async () => {
    await writeCfg({ enabled: false, installId: "test-id-disabled" });

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await emit({ type: "command", command: "add", exitCode: 0, durationMs: 100 });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalled).toBe(false);
  });

  test("fetch is never called when no config file exists", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await emit({ type: "command", command: "scan" });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. emit when enabled POSTs with expected payload
// ---------------------------------------------------------------------------

describe("emit when enabled", () => {
  test("POSTs JSON with correct shape to the default endpoint", async () => {
    await writeCfg({ enabled: true, installId: "fixed-install-id" });

    let capturedBody: unknown;
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url as string;
      capturedBody = JSON.parse(init?.body as string);
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await emit({ type: "command", command: "add", exitCode: 0, durationMs: 42 });
    await new Promise((r) => setTimeout(r, 100));

    expect(capturedUrl).toBe("https://telemetry.stack.ashlr.ai/v1/events");
    const body = capturedBody as Record<string, unknown>;
    expect(body.type).toBe("command");
    expect(body.command).toBe("add");
    expect(body.exitCode).toBe(0);
    expect(body.durationMs).toBe(42);
    expect(body.installId).toBe("fixed-install-id");
    expect(typeof body.runId).toBe("string");
    expect(body.platform).toBeDefined();
    expect(body.stackVersion).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. STACK_TELEMETRY=0 overrides to disabled
// ---------------------------------------------------------------------------

describe("STACK_TELEMETRY env var", () => {
  test("STACK_TELEMETRY=0 prevents emit even when config.enabled = true", async () => {
    await writeCfg({ enabled: true, installId: "env-off-test" });
    process.env.STACK_TELEMETRY = "0";

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await emit({ type: "command", command: "scan" });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalled).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 4. STACK_TELEMETRY=1 without prior opt-in stays disabled
  // ---------------------------------------------------------------------------

  test("STACK_TELEMETRY=1 alone does not enable telemetry (no prior opt-in)", async () => {
    await writeCfg({ enabled: false, installId: "env-on-test" });
    process.env.STACK_TELEMETRY = "1";

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    // isEnabled() must return false — env=1 is not a substitute for opt-in.
    expect(await isEnabled()).toBe(false);

    await emit({ type: "command", command: "add" });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. emit with fetch throwing → no error propagated
// ---------------------------------------------------------------------------

describe("emit error swallowing", () => {
  test("network error does not propagate to the caller", async () => {
    await writeCfg({ enabled: true, installId: "throw-test-id" });
    globalThis.fetch = (async () => {
      throw new Error("network failure");
    }) as unknown as typeof fetch;

    await expect(
      emit({ type: "error", command: "add", exitCode: 1, durationMs: 5 }),
    ).resolves.toBeUndefined();

    await new Promise((r) => setTimeout(r, 100));
  });
});

// ---------------------------------------------------------------------------
// 6. installId persists across calls
// ---------------------------------------------------------------------------

describe("installId persistence", () => {
  test("same installId is emitted on every call", async () => {
    await writeCfg({ enabled: true, installId: "persisted-id-123" });

    const ids: string[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      ids.push(body.installId as string);
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await emit({ type: "command", command: "add" });
    await emit({ type: "command", command: "scan" });
    await new Promise((r) => setTimeout(r, 150));

    expect(ids.length).toBe(2);
    expect(ids[0]).toBe("persisted-id-123");
    expect(ids[1]).toBe("persisted-id-123");
  });
});

// ---------------------------------------------------------------------------
// 7. No path/cwd/project in the emitted payload
// ---------------------------------------------------------------------------

describe("privacy: banned fields absent from payload", () => {
  const BANNED_KEYS = [
    "cwd",
    "projectName",
    "project_name",
    "project",
    "provider",
    "providerName",
    "secret",
    "secretValue",
    "secretKey",
    "envValue",
    "homePath",
    "home",
    "stackToml",
    "stack_toml",
  ];

  test("emitted payload contains none of the banned keys", async () => {
    await writeCfg({ enabled: true, installId: "privacy-test-id" });

    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await emit({ type: "command", command: "add", exitCode: 0, durationMs: 10 });
    await new Promise((r) => setTimeout(r, 100));

    for (const key of BANNED_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(capturedBody, key)).toBe(false);
    }
  });

  test("installId is a UUID (no path segments)", async () => {
    await writeCfg({ enabled: true, installId: crypto.randomUUID() });

    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    await emit({ type: "command", command: "scan" });
    await new Promise((r) => setTimeout(r, 100));

    const installId = capturedBody.installId as string;
    expect(installId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(installId).not.toContain("/");
    expect(installId).not.toContain("\\");
  });
});

// ---------------------------------------------------------------------------
// 8. isEnabled reflects stored config
// ---------------------------------------------------------------------------

describe("isEnabled", () => {
  test("returns false when no config file exists", async () => {
    expect(await isEnabled()).toBe(false);
  });

  test("returns true when config.enabled = true", async () => {
    await writeCfg({ enabled: true, installId: "check-id" });
    expect(await isEnabled()).toBe(true);
  });

  test("returns false when STACK_TELEMETRY=0 even if enabled=true", async () => {
    await writeCfg({ enabled: true, installId: "check-id" });
    process.env.STACK_TELEMETRY = "0";
    expect(await isEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. disable() and enable() round-trip
// ---------------------------------------------------------------------------

describe("disable / enable", () => {
  test("disable() writes enabled=false", async () => {
    await writeCfg({ enabled: true, installId: "round-trip-id" });
    await disableTelemetry();
    expect(await isEnabled()).toBe(false);
  });

  test("enable() writes enabled=true and creates installId if missing", async () => {
    await writeCfg({ enabled: false });
    await enableTelemetry();
    expect(await isEnabled()).toBe(true);

    const raw = await readFile(TMP_CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw) as { installId?: string };
    expect(cfg.installId).toBeDefined();
    expect(cfg.installId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
