import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import aws from "../providers/aws.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

describe("aws deprovision", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  test("success — STS validates credentials, resolves without error", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("sts.amazonaws.com") || u.includes("sts.us-east-1")) {
        // Return a plausible STS XML response
        return new Response(
          `<GetCallerIdentityResponse>
            <GetCallerIdentityResult>
              <Arn>arn:aws:iam::123456789012:user/test</Arn>
              <UserId>AIDATEST</UserId>
              <Account>123456789012</Account>
            </GetCallerIdentityResult>
          </GetCallerIdentityResponse>`,
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    const auth = {
      token: "AKIATEST:secretkey",
      identity: { Account: "123456789012", Arn: "arn:aws:iam::123456789012:user/test" },
    };
    await expect(aws.deprovision!(ctx, auth, "123456789012")).resolves.toBeUndefined();
  });

  test("malformed token (no colon) throws AWS_DEPROVISION_FAILED", async () => {
    const badAuth = { token: "no-colon-here", identity: {} };

    await expect(aws.deprovision!(ctx, badAuth, "123456789012")).rejects.toMatchObject({
      code: "AWS_DEPROVISION_FAILED",
    });
  });

  test("STS rejects credentials (invalid key) throws AWS_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => new Response("invalid signature", { status: 403 })) as typeof fetch;

    const auth = {
      token: "AKIAINVALID:invalidsecret",
      identity: { Account: "123456789012" },
    };
    await expect(aws.deprovision!(ctx, auth, "123456789012")).rejects.toMatchObject({
      code: "AWS_DEPROVISION_FAILED",
    });
  });

  test("network error throws AWS_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network failure");
    }) as typeof fetch;

    const auth = { token: "AKIATEST:secretkey", identity: {} };
    await expect(aws.deprovision!(ctx, auth, "123456789012")).rejects.toMatchObject({
      code: "AWS_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    const auth = { token: "AKIATEST:secretkey", identity: {} };
    await expect(aws.deprovision!(abortCtx, auth, "123456789012")).rejects.toMatchObject({
      code: "AWS_DEPROVISION_ABORTED",
    });
  });
});
