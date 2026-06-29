import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import convex from "../providers/convex.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("convex deprovision", () => {
  let h: Harness;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const VALID_KEY = "prod:myteam:myproject|tok_abcdef1234567890";
  const auth = {
    token: VALID_KEY,
    identity: { environment: "prod", team: "myteam", project: "myproject" },
  };

  beforeEach(() => {
    h = setupFakePhantom();
  });

  afterEach(() => {
    h.cleanup();
  });

  test("success — valid deploy key, resolves without error", async () => {
    await expect(convex.deprovision!(ctx, auth, "prod:myteam:myproject")).resolves.toBeUndefined();
  });

  test("malformed key (no pipe) throws CONVEX_DEPROVISION_FAILED", async () => {
    const badAuth = { token: "not-a-valid-key", identity: {} };

    await expect(convex.deprovision!(ctx, badAuth, "proj")).rejects.toMatchObject({
      code: "CONVEX_DEPROVISION_FAILED",
    });
  });

  test("malformed key (missing colon segments) throws CONVEX_DEPROVISION_FAILED", async () => {
    const badAuth = { token: "prod|tok_abc", identity: {} };

    await expect(convex.deprovision!(ctx, badAuth, "proj")).rejects.toMatchObject({
      code: "CONVEX_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(convex.deprovision!(abortCtx, auth, "proj")).rejects.toMatchObject({
      code: "CONVEX_DEPROVISION_ABORTED",
    });
  });
});
