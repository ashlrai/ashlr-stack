import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import gcp from "../providers/gcp.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

const VALID_SA_JSON = JSON.stringify({
  type: "service_account",
  project_id: "my-gcp-project",
  client_email: "sa@my-gcp-project.iam.gserviceaccount.com",
  private_key_id: "key123",
  private_key: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n",
});

describe("gcp deprovision", () => {
  let h: Harness;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = {
    token: VALID_SA_JSON,
    identity: { project_id: "my-gcp-project", client_email: "sa@my-gcp-project.iam.gserviceaccount.com" },
  };

  beforeEach(() => {
    h = setupFakePhantom();
  });

  afterEach(() => {
    h.cleanup();
  });

  test("success — valid service-account JSON, resolves without error", async () => {
    await expect(gcp.deprovision!(ctx, auth, "my-gcp-project")).resolves.toBeUndefined();
  });

  test("malformed JSON in token throws GCP_DEPROVISION_FAILED", async () => {
    const badAuth = { token: "not-json", identity: {} };

    await expect(gcp.deprovision!(ctx, badAuth, "my-gcp-project")).rejects.toMatchObject({
      code: "GCP_DEPROVISION_FAILED",
    });
  });

  test("wrong type in service account JSON throws GCP_DEPROVISION_FAILED", async () => {
    const wrongTypeAuth = {
      token: JSON.stringify({ type: "user_account", project_id: "x", client_email: "y@x.com" }),
      identity: {},
    };

    await expect(gcp.deprovision!(ctx, wrongTypeAuth, "proj")).rejects.toMatchObject({
      code: "GCP_DEPROVISION_FAILED",
    });
  });

  test("missing client_email throws GCP_DEPROVISION_FAILED", async () => {
    const missingFieldAuth = {
      token: JSON.stringify({ type: "service_account", project_id: "x" }),
      identity: {},
    };

    await expect(gcp.deprovision!(ctx, missingFieldAuth, "proj")).rejects.toMatchObject({
      code: "GCP_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(gcp.deprovision!(abortCtx, auth, "my-gcp-project")).rejects.toMatchObject({
      code: "GCP_DEPROVISION_ABORTED",
    });
  });
});
