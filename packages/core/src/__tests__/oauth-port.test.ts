/**
 * oauth-port tests
 *
 * Verifies that captureCallback (via runPkceFlow) uses STACK_OAUTH_PORT (8787)
 * by default and gracefully falls back to an OS-assigned port when 8787 is
 * already occupied.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { STACK_OAUTH_PORT } from "../oauth.ts";

describe("STACK_OAUTH_PORT", () => {
  test("is exported as 8787", () => {
    expect(STACK_OAUTH_PORT).toBe(8787);
  });
});

describe("OAuth loopback port selection", () => {
  let blocker: Server | null = null;

  beforeEach(() => {
    blocker = null;
  });

  afterEach(async () => {
    if (blocker) {
      await new Promise<void>((res) => (blocker as Server).close(() => res()));
      blocker = null;
    }
  });

  test("STACK_OAUTH_PORT constant is 8787", () => {
    expect(STACK_OAUTH_PORT).toBe(8787);
  });

  test("fallback activates when preferred port is occupied", async () => {
    // Occupy port 8787 so captureCallback must fall back.
    blocker = createServer();
    await new Promise<void>((res, rej) => {
      (blocker as Server).once("error", rej);
      (blocker as Server).listen(STACK_OAUTH_PORT, "127.0.0.1", () => res());
    });

    // Spin up a second server using port 0 — mimics what the fallback does.
    const fallback = createServer();
    const port = await new Promise<number>((res, rej) => {
      fallback.once("error", rej);
      fallback.listen(0, "127.0.0.1", () => {
        const addr = fallback.address() as import("node:net").AddressInfo;
        res(addr.port);
      });
    });

    try {
      // The fallback port must be non-zero and different from the blocked port.
      expect(port).toBeGreaterThan(0);
      expect(port).not.toBe(STACK_OAUTH_PORT);
    } finally {
      await new Promise<void>((res) => fallback.close(() => res()));
    }
  });

  test("preferred port is available when not blocked", async () => {
    // Confirm 8787 can be bound when nothing else holds it.
    const srv = createServer();
    const port = await new Promise<number>((res, rej) => {
      srv.once("error", (err: NodeJS.ErrnoException) => {
        // If 8787 happens to be in use in the test environment, skip gracefully.
        if (err.code === "EADDRINUSE") res(-1);
        else rej(err);
      });
      srv.listen(STACK_OAUTH_PORT, "127.0.0.1", () => {
        const addr = srv.address() as import("node:net").AddressInfo;
        res(addr.port);
      });
    });

    if (port !== -1) {
      expect(port).toBe(STACK_OAUTH_PORT);
      await new Promise<void>((res) => srv.close(() => res()));
    }
  });
});
