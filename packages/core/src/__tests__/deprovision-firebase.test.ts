import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ProviderContext } from "../providers/_base.ts";
import firebase from "../providers/firebase.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

const VALID_SA_JSON = JSON.stringify({
  type: "service_account",
  project_id: "my-firebase-project",
  client_email: "sa@my-firebase-project.iam.gserviceaccount.com",
  private_key_id: "key123",
  private_key: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n",
});

describe("firebase deprovision", () => {
  let h: Harness;

  const ctx: ProviderContext = { cwd: process.cwd(), interactive: false, log: () => {} };
  const auth = {
    token: VALID_SA_JSON,
    identity: { project_id: "my-firebase-project", client_email: "sa@my-firebase-project.iam.gserviceaccount.com" },
  };

  beforeEach(() => {
    h = setupFakePhantom();
  });

  afterEach(() => {
    h.cleanup();
  });

  test("success — valid service-account JSON, resolves without error", async () => {
    await expect(firebase.deprovision!(ctx, auth, "my-firebase-project")).resolves.toBeUndefined();
  });

  test("malformed JSON in token throws FIREBASE_DEPROVISION_FAILED", async () => {
    const badAuth = { token: "not-json", identity: {} };

    await expect(firebase.deprovision!(ctx, badAuth, "my-firebase-project")).rejects.toMatchObject({
      code: "FIREBASE_DEPROVISION_FAILED",
    });
  });

  test("wrong type in service account JSON throws FIREBASE_DEPROVISION_FAILED", async () => {
    const wrongTypeAuth = {
      token: JSON.stringify({ type: "user", project_id: "x", client_email: "y@x.com" }),
      identity: {},
    };

    await expect(firebase.deprovision!(ctx, wrongTypeAuth, "proj")).rejects.toMatchObject({
      code: "FIREBASE_DEPROVISION_FAILED",
    });
  });

  test("missing project_id throws FIREBASE_DEPROVISION_FAILED", async () => {
    const missingFieldAuth = {
      token: JSON.stringify({ type: "service_account", client_email: "sa@x.com" }),
      identity: {},
    };

    await expect(firebase.deprovision!(ctx, missingFieldAuth, "proj")).rejects.toMatchObject({
      code: "FIREBASE_DEPROVISION_FAILED",
    });
  });

  test("respects ctx.signal abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortCtx: ProviderContext = { ...ctx, signal: controller.signal };

    await expect(firebase.deprovision!(abortCtx, auth, "my-firebase-project")).rejects.toMatchObject({
      code: "FIREBASE_DEPROVISION_ABORTED",
    });
  });
});
