import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LogEvent } from "../providers/_base.ts";
import { scrub } from "../providers/_helpers.ts";
import { makeApiKeyProvider } from "../providers/_api-key.ts";
import { StackError } from "../errors.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

/**
 * Secret redaction regression pack.
 *
 * The biggest exfiltration risk for Stack is a log line that interpolates a
 * raw token — tokens end up in CI artifacts, shell scrollback, sentry
 * breadcrumbs, etc. These tests pin the contract: when an API-key provider
 * discovers a cached token is no longer valid and logs a warning, the raw
 * token MUST NOT appear in the log message.
 */

describe("scrub()", () => {
  test("keeps the last N chars and masks the rest", () => {
    expect(scrub("sk-abcdef1234567890")).toBe("****7890");
    expect(scrub("sk-abcdef1234567890", 6)).toBe("****567890");
  });

  test("short strings are fully redacted", () => {
    expect(scrub("abcd")).toBe("****");
    expect(scrub("abc")).toBe("****");
  });

  test("empty string returns empty", () => {
    expect(scrub("")).toBe("");
  });
});

describe("api-key provider login — invalid cached token warning", () => {
  let h: Harness;
  let realFetch: typeof fetch;
  const RAW_TOKEN = "sk-SECRET-ABCD-1234-SHOULD-NOT-LEAK-XYZ";

  beforeEach(() => {
    // Seed the vault so the provider's login() finds a cached token to reject.
    h = setupFakePhantom({ TEST_PROVIDER_KEY: RAW_TOKEN });
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("log lines never contain the raw cached token", async () => {
    const logs: LogEvent[] = [];

    const provider = makeApiKeyProvider({
      name: "testprov",
      displayName: "Test Provider",
      category: "ai",
      docs: "https://example.com",
      secretName: "TEST_PROVIDER_KEY",
      howTo: "n/a",
      async verify(_key) {
        // Simulate server rejection to trigger the "cached invalid" branch.
        return undefined;
      },
    });

    await expect(
      provider.login({
        cwd: process.cwd(),
        interactive: false, // forces the no-prompt failure path
        log: (event) => logs.push(event),
      }),
    ).rejects.toThrow(StackError);

    // The provider emitted at least one warn log about the cached token.
    const warn = logs.find((l) => l.level === "warn");
    expect(warn).toBeDefined();
    // The raw token must not appear anywhere in the message or data payload.
    const full =
      (warn?.msg ?? "") + " " + JSON.stringify(warn?.data ?? {});
    expect(full).not.toContain(RAW_TOKEN);
    // And the tail of the token (last 6 chars) must not leak either — the
    // current _api-key warn doesn't reference the token at all, so belt + suspenders.
    expect(full).not.toContain(RAW_TOKEN.slice(-6));
  });
});

describe("phantom error formatting — regression guard for formatArgsForError", () => {
  /**
   * Hand-roll a tiny phantom replacement that exits 1 on every call, so we
   * can observe how `exec()` stringifies the failed-args list into its
   * StackError. The full fake harness succeeds on `add`, which wouldn't
   * exercise the error path.
   */
  function setupAlwaysFailingPhantom(): { cleanup(): void } {
    const { chmodSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const { join } = require("node:path") as typeof import("node:path");
    const { __resetPhantomCache } = require("../phantom.ts") as typeof import("../phantom.ts");

    const dir = mkdtempSync(join(tmpdir(), "stack-phantom-fail-"));
    const script = `#!/usr/bin/env bash
case "\${1:-}" in
  --version) echo "phantom fake 0.0.1" ;;
  *) echo "boom" >&2; exit 1 ;;
esac
`;
    const binPath = join(dir, "phantom");
    writeFileSync(binPath, script);
    chmodSync(binPath, 0o755);

    const previousPath = process.env.PATH ?? "";
    process.env.PATH = `${dir}:${previousPath}`;
    __resetPhantomCache();

    return {
      cleanup() {
        process.env.PATH = previousPath;
        __resetPhantomCache();
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      },
    };
  }

  test("failed `phantom add <KEY> <VALUE>` never leaks the VALUE", async () => {
    const SECRET = "super-secret-VALUE-that-MUST-not-LEAK-999";
    const h = setupAlwaysFailingPhantom();
    try {
      const { exec } = await import("../phantom.ts");
      let caught: Error | undefined;
      try {
        await exec(["add", "LEAKY_KEY", SECRET]);
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).toBeDefined();
      // The canonical guarantee: the raw value NEVER appears in the error.
      expect(caught!.message).not.toContain(SECRET);
      // The key name is safe to show — it's the vault slot, not the value.
      expect(caught!.message).toContain("LEAKY_KEY");
      // And the redaction sentinel should be present.
      expect(caught!.message).toContain("<redacted>");
    } finally {
      h.cleanup();
    }
  });

  test("reveal / list / status calls pass their args through unredacted (no secret in args)", async () => {
    const h = setupAlwaysFailingPhantom();
    try {
      const { exec } = await import("../phantom.ts");
      let caught: Error | undefined;
      try {
        await exec(["reveal", "SOME_KEY"]);
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).toBeDefined();
      // Reveal's second arg is a key name, not a secret value — it's fine
      // for it to appear in error output. The point is that `add`'s third arg
      // is redacted, and reveal's isn't wrongly redacted into uselessness.
      expect(caught!.message).toContain("SOME_KEY");
    } finally {
      h.cleanup();
    }
  });
});
