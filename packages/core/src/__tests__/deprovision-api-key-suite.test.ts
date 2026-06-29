import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AuthHandle, ProviderContext } from "../providers/_base.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

/**
 * Deprovision test suite for all 19 API-key-only providers.
 *
 * Covers:
 *   (a) successful deprovision for a provider with real cleanup (Datadog)
 *   (b) graceful no-op for providers without cleanup APIs (anthropic, openai, etc.)
 *   (c) error handling when cleanup fails
 *   (d) rollback transcript accuracy (structured log fields)
 *   (e) partial failure across multiple deprovisioned providers in one orchestration group
 */

const ctx: ProviderContext = {
  cwd: process.cwd(),
  interactive: false,
  log: () => {},
};

const auth: AuthHandle = { token: "sk-test-key", identity: { id: "resource-abc" } };

describe("deprovision-api-key-suite", () => {
  let h: Harness;
  let realFetch: typeof fetch;

  beforeEach(() => {
    h = setupFakePhantom();
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    h.cleanup();
  });

  // (a) Successful deprovision for a provider with real cleanup — Datadog
  // with a resource ID that looks like a key handle and app_key in identity.
  test("(a) datadog: deprovision with app key calls DELETE and resolves on 204", async () => {
    let deleteCalled = false;
    let deletedId = "";

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/v2/api_keys/") && init?.method === "DELETE") {
        deleteCalled = true;
        deletedId = u.split("/api/v2/api_keys/")[1] ?? "";
        return new Response("", { status: 204 });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${u}`);
    }) as typeof fetch;

    const datadog = (await import("../providers/datadog.ts")).default;
    const ddAuth: AuthHandle = {
      token: "dd-api-key-fake",
      identity: { app_key: "dd-app-key-fake" },
    };
    const resourceId = "key_handle_abc123";

    await expect(datadog.deprovision!(ctx, ddAuth, resourceId)).resolves.toBeUndefined();
    expect(deleteCalled).toBe(true);
    expect(deletedId).toBe(resourceId);
  });

  // (b) Graceful no-op — providers without cleanup APIs log and return cleanly.
  // Covers: anthropic, openai, xai, deepseek, resend, braintrust, sendgrid,
  // mailgun, postmark, replicate, plausible, mixpanel, workos, modal,
  // grafana, hetzner, launchdarkly, digitalocean.
  test("(b) no-op providers: all 18 no-cleanup providers resolve without error", async () => {
    // Should never make a network call
    globalThis.fetch = (async () => {
      throw new Error("unexpected fetch in no-op deprovision");
    }) as typeof fetch;

    const noOpProviders = [
      "../providers/anthropic.ts",
      "../providers/openai.ts",
      "../providers/xai.ts",
      "../providers/deepseek.ts",
      "../providers/resend.ts",
      "../providers/braintrust.ts",
      "../providers/sendgrid.ts",
      "../providers/mailgun.ts",
      "../providers/postmark.ts",
      "../providers/replicate.ts",
      "../providers/plausible.ts",
      "../providers/mixpanel.ts",
      "../providers/workos.ts",
      "../providers/modal.ts",
      "../providers/grafana.ts",
      "../providers/hetzner.ts",
      "../providers/launchdarkly.ts",
      "../providers/digitalocean.ts",
    ];

    for (const modulePath of noOpProviders) {
      const provider = (await import(modulePath)).default;
      expect(provider.deprovision, `${modulePath} should have deprovision`).toBeDefined();
      await expect(
        provider.deprovision!(ctx, auth, "default"),
        `${modulePath} deprovision should resolve cleanly`,
      ).resolves.toBeUndefined();
    }
  });

  // (c) Error handling — cleanup fails (Datadog 403) throws with provider-namespaced code.
  test("(c) datadog: cleanup HTTP 403 throws DATADOG_DEPROVISION_FAILED", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: ["Forbidden"] }), { status: 403 })) as typeof fetch;

    const datadog = (await import("../providers/datadog.ts")).default;
    const ddAuth: AuthHandle = {
      token: "dd-api-key-fake",
      identity: { app_key: "dd-app-key-fake" },
    };

    await expect(datadog.deprovision!(ctx, ddAuth, "key_handle_forbidden")).rejects.toMatchObject({
      code: "DATADOG_DEPROVISION_FAILED",
    });
  });

  // (d) Rollback transcript accuracy — structured log fields are correct.
  test("(d) no-op log contains resourceId, provider, and docsUrl fields", async () => {
    const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
    const logCtx: ProviderContext = { ...ctx, log: (e) => logs.push(e) };

    const anthropic = (await import("../providers/anthropic.ts")).default;
    await anthropic.deprovision!(logCtx, auth, "res-anthropic-123");

    const infoLog = logs.find((l) => l.level === "info" && l.msg.includes("anthropic"));
    expect(infoLog).toBeDefined();
    expect(infoLog?.data?.resourceId).toBe("res-anthropic-123");
    expect(infoLog?.data?.provider).toBe("anthropic");
    expect(typeof infoLog?.data?.docsUrl).toBe("string");
    expect((infoLog?.data?.docsUrl as string).length).toBeGreaterThan(0);
    expect(infoLog?.data?.reason).toMatch(/revoked manually/i);
  });

  // (e) Partial failure — multiple providers in an orchestration group where one
  // has a real cleanup that fails, others are no-ops. The no-ops still complete.
  test("(e) partial failure: failed cleanup does not block other providers", async () => {
    // Datadog will fail (HTTP 500), others will no-op successfully.
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/v2/api_keys/") && init?.method === "DELETE") {
        return new Response("internal error", { status: 500 });
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as typeof fetch;

    const datadog = (await import("../providers/datadog.ts")).default;
    const openai = (await import("../providers/openai.ts")).default;
    const resend = (await import("../providers/resend.ts")).default;

    const ddAuth: AuthHandle = {
      token: "dd-api-key-fail",
      identity: { app_key: "dd-app-key-fail" },
    };

    // Collect results for each provider deprovision call.
    const results = await Promise.allSettled([
      datadog.deprovision!(ctx, ddAuth, "key_handle_will_fail"),
      openai.deprovision!(ctx, auth, "default"),
      resend.deprovision!(ctx, auth, "default"),
    ]);

    // Datadog should fail with DATADOG_DEPROVISION_FAILED
    expect(results[0].status).toBe("rejected");
    expect((results[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "DATADOG_DEPROVISION_FAILED",
    });

    // OpenAI and Resend should succeed (no-op)
    expect(results[1].status).toBe("fulfilled");
    expect(results[2].status).toBe("fulfilled");
  });

  // Extra: Datadog with no app_key logs a no-op info and does not throw.
  test("datadog: missing app key logs info and resolves without error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("unexpected fetch when app key missing");
    }) as typeof fetch;

    const logs: Array<{ level: string; msg: string; data?: Record<string, unknown> }> = [];
    const logCtx: ProviderContext = { ...ctx, log: (e) => logs.push(e) };

    const datadog = (await import("../providers/datadog.ts")).default;
    const ddAuthNoAppKey: AuthHandle = {
      token: "dd-api-key-fake",
      identity: {}, // no app_key
    };

    await expect(
      datadog.deprovision!(logCtx, ddAuthNoAppKey, "key_handle_no_app_key"),
    ).resolves.toBeUndefined();

    const infoLog = logs.find((l) => l.level === "info" && l.msg.includes("no application key"));
    expect(infoLog).toBeDefined();
  });

  // Extra: Datadog with resourceId "default" skips cleanup entirely.
  test("datadog: resourceId 'default' skips cleanup without fetch", async () => {
    globalThis.fetch = (async () => {
      throw new Error("unexpected fetch for default resourceId");
    }) as typeof fetch;

    const datadog = (await import("../providers/datadog.ts")).default;
    const ddAuth: AuthHandle = {
      token: "dd-api-key-fake",
      identity: { app_key: "dd-app-key-fake" },
    };

    await expect(datadog.deprovision!(ctx, ddAuth, "default")).resolves.toBeUndefined();
  });

  // Extra: Datadog treats HTTP 404 as idempotent (already deleted).
  test("datadog: HTTP 404 on DELETE is idempotent", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;

    const datadog = (await import("../providers/datadog.ts")).default;
    const ddAuth: AuthHandle = {
      token: "dd-api-key-fake",
      identity: { app_key: "dd-app-key-fake" },
    };

    await expect(
      datadog.deprovision!(ctx, ddAuth, "key_handle_already_gone"),
    ).resolves.toBeUndefined();
  });
});
