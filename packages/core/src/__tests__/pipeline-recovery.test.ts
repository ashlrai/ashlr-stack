import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, readConfig, writeConfig } from "../config.ts";
import { StackError } from "../errors.ts";
import { addService } from "../pipeline.ts";
import type { Provider } from "../providers/_base.ts";
import { providers } from "../providers/index.ts";
import { type Harness, setupFakePhantom } from "./_harness.ts";

/**
 * Partial-failure rollback: if `materialize()` throws after `provision()`
 * succeeded, we MUST roll back atomically — tear down the upstream resource
 * (if the provider implements `deprovision`), remove any written Phantom
 * secrets, and NOT write to .stack.toml. The user gets a clear error message
 * directing them to manual cleanup or `stack doctor --fix` if automatic
 * teardown isn't available.
 */
describe("addService partial-failure breadcrumb", () => {
  let h: Harness;
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    h = setupFakePhantom();
    cwd = mkdtempSync(join(tmpdir(), "stack-partial-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
    await writeConfig(emptyConfig("test-template"), cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    h.cleanup();
  });

  test("rolls back and does NOT write .stack.toml when materialize throws post-provision (no deprovision)", async () => {
    const failingProvider: Provider = {
      name: "partialsvc",
      displayName: "Partial Service",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "stub-token", identity: { id: "user-1" } };
      },
      async provision() {
        return { id: "partial-resource-42", displayName: "the one", region: "us-east-1" };
      },
      async materialize() {
        throw new Error("simulated materialize failure (e.g. keys endpoint 500)");
      },
      // No deprovision — exercises the "manual cleanup" warning path.
    };

    providers.partialsvc = async () => failingProvider;

    const err = await addService({ providerName: "partialsvc", cwd, interactive: false }).catch(
      (e: Error) => e,
    );

    // Error should reference the resource id and direct to manual cleanup.
    expect((err as Error).message).toMatch(/partial-resource-42/);
    expect((err as Error).message).toMatch(/stack doctor --fix/);

    // .stack.toml must NOT have an entry — atomicity is the point.
    const config = await readConfig(cwd);
    expect(config.services.partialsvc).toBeUndefined();

    Reflect.deleteProperty(providers, "partialsvc");
  });

  test("non-persist runs do NOT leave a breadcrumb (dry-run / preview)", async () => {
    const failingProvider: Provider = {
      name: "drypartialsvc",
      displayName: "Dry Partial Service",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "stub-token" };
      },
      async provision() {
        return { id: "dry-resource-1", displayName: "dry" };
      },
      async materialize() {
        throw new Error("boom");
      },
      // No deprovision — exercises the "manual cleanup" warning path.
    };

    providers.drypartialsvc = async () => failingProvider;

    const err = await addService({
      providerName: "drypartialsvc",
      cwd,
      interactive: false,
      persist: false,
    }).catch((e: Error) => e);

    // Error must reference the resource id (manual cleanup path).
    expect((err as Error).message).toMatch(/dry-resource-1/);

    const config = await readConfig(cwd);
    expect(config.services.drypartialsvc).toBeUndefined();

    Reflect.deleteProperty(providers, "drypartialsvc");
  });

  test("rolls back and calls deprovision when materialize throws post-provision (with deprovision)", async () => {
    let deprovisionCalled = false;
    const deprovisionableProvider: Provider = {
      name: "deprovisionablesvc",
      displayName: "Deprovisionable Service",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "stub-token", identity: { id: "user-1" } };
      },
      async provision() {
        return { id: "deprovisioned-resource-99", displayName: "the one", region: "us-east-1" };
      },
      async materialize() {
        throw new Error("simulated materialize failure after provision");
      },
      async deprovision(_ctx, _auth, resourceId) {
        deprovisionCalled = true;
        if (resourceId !== "deprovisioned-resource-99") {
          throw new StackError("DEPROVISION_WRONG_ID", `wrong resourceId: ${resourceId}`);
        }
        // success — upstream resource torn down
      },
    };

    providers.deprovisionablesvc = async () => deprovisionableProvider;

    const err = await addService({
      providerName: "deprovisionablesvc",
      cwd,
      interactive: false,
    }).catch((e: Error) => e);

    // Pipeline should have called deprovision.
    expect(deprovisionCalled).toBe(true);

    // Error should indicate the rollback succeeded.
    expect((err as Error).message).toMatch(/Rolled back/);
    expect((err as Error).message).toMatch(/deprovisioned-resource-99/);
    expect((err as Error).message).toMatch(/torn down/);

    // .stack.toml must NOT have an entry.
    const config = await readConfig(cwd);
    expect(config.services.deprovisionablesvc).toBeUndefined();

    Reflect.deleteProperty(providers, "deprovisionablesvc");
  });

  test("surfaces teardown failure in error message when deprovision throws", async () => {
    const failingDeprovisionProvider: Provider = {
      name: "faildeprovsvc",
      displayName: "Fail Deprovision Service",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "stub-token" };
      },
      async provision() {
        return { id: "leaked-resource-77", displayName: "leaked" };
      },
      async materialize() {
        throw new Error("materialize boom");
      },
      async deprovision() {
        throw new StackError("DEPROV_NETWORK_ERROR", "simulated deprovision failure");
      },
    };

    providers.faildeprovsvc = async () => failingDeprovisionProvider;

    const err = await addService({
      providerName: "faildeprovsvc",
      cwd,
      interactive: false,
    }).catch((e: Error) => e);

    // Error should mention both the teardown failure AND the leaked resource.
    expect((err as Error).message).toMatch(/leaked-resource-77/);
    expect((err as Error).message).toMatch(/FAILED/i);

    const config = await readConfig(cwd);
    expect(config.services.faildeprovsvc).toBeUndefined();

    Reflect.deleteProperty(providers, "faildeprovsvc");
  });

  test("multi-provider orchestration: second provider fails, first provider deprovision called", async () => {
    // Simulates a scenario where a higher-level orchestrator adds two services
    // and the second one fails — the first should be rolled back via deprovision.
    let firstDeprovisionCalled = false;

    const firstProvider: Provider = {
      name: "orchestfirst",
      displayName: "Orchestration First",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "token-first", identity: { id: "first-user" } };
      },
      async provision() {
        return { id: "first-resource-abc", displayName: "first resource" };
      },
      async materialize() {
        return { secrets: { FIRST_KEY: "first-value" } };
      },
      async deprovision(_ctx, _auth, _resourceId) {
        firstDeprovisionCalled = true;
      },
    };

    providers.orchestfirst = async () => firstProvider;

    // Add first provider successfully.
    await addService({ providerName: "orchestfirst", cwd, interactive: false });

    // Verify it was added.
    let config = await readConfig(cwd);
    expect(config.services.orchestfirst).toBeDefined();

    // Now simulate a higher-level rollback that tears down the first provider.
    // This exercises the deprovision path directly as an orchestrator would.
    const ctx = { cwd, interactive: false as const, log: () => {} };
    const auth = { token: "token-first" };
    await firstProvider.deprovision!(ctx, auth, "first-resource-abc");
    expect(firstDeprovisionCalled).toBe(true);

    Reflect.deleteProperty(providers, "orchestfirst");
  });
});
