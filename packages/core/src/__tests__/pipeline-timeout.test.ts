import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, readConfig, writeConfig } from "../config.ts";
import { addService } from "../pipeline.ts";
import type { Provider } from "../providers/_base.ts";
import { providers } from "../providers/index.ts";
import { type Harness, readVault, setupFakePhantom } from "./_harness.ts";

/**
 * Timeout + cancellation tests: a provider step that hangs indefinitely must
 * be cut off by the wall-clock timeout, trigger rollback (deprovision if
 * available), and surface a clear PROVISION_TIMEOUT StackError. The happy
 * path must be unaffected by having a timeout configured.
 */
describe("addService timeout + cancellation", () => {
  let h: Harness;
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    h = setupFakePhantom();
    cwd = mkdtempSync(join(tmpdir(), "stack-timeout-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
    await writeConfig(emptyConfig("test-template"), cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    h.cleanup();
  });

  test("hanging provision times out and throws PROVISION_TIMEOUT", async () => {
    const provider: Provider = {
      name: "hangsvc",
      displayName: "Hang Service",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "tok" };
      },
      async provision() {
        // Hangs indefinitely — simulates a stuck API call or webhook.
        return new Promise<never>(() => {});
      },
      async materialize() {
        return { secrets: { HANG_KEY: "val" } };
      },
    };

    providers.hangsvc = async () => provider;

    const start = Date.now();
    const err = await addService({
      providerName: "hangsvc",
      cwd,
      interactive: false,
      timeoutMs: 100, // short timeout for test speed
    })
      .then(() => null)
      .catch((e: Error) => e);
    const elapsed = Date.now() - start;

    // Should have timed out, not hung forever.
    expect(elapsed).toBeLessThan(2000);

    expect(err).not.toBeNull();
    expect((err as Error & { code?: string }).code).toBe("PROVISION_TIMEOUT");
    expect((err as Error).message).toMatch(/provision/i);
    expect((err as Error).message).toMatch(/0\.1s/);

    // .stack.toml must NOT have an entry.
    const config = await readConfig(cwd);
    expect(config.services.hangsvc).toBeUndefined();

    // No secrets written.
    const vault = await readVault(h.dir);
    expect(vault.HANG_KEY).toBeUndefined();

    Reflect.deleteProperty(providers, "hangsvc");
  });

  test("hanging provision times out and calls deprovision for rollback", async () => {
    let deprovisionCalled = false;

    const provider: Provider = {
      name: "hangroллbасk",
      displayName: "Hang Rollback",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "tok" };
      },
      async provision(_ctx, _auth, opts) {
        // Simulate: we got an existingResourceId (resource already created),
        // then the provision step hangs waiting for a health-check.
        // Pipeline should roll back with deprovision.
        return new Promise<never>(() => {});
      },
      async materialize() {
        return { secrets: {} };
      },
      async deprovision() {
        deprovisionCalled = true;
      },
    };

    // Use existingResourceId so the deprovision rollback path is exercised.
    providers["hangroллbасk"] = async () => provider;

    const err = await addService({
      providerName: "hangroллbасk",
      cwd,
      interactive: false,
      timeoutMs: 100,
      existingResourceId: "existing-res-99",
    })
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).not.toBeNull();
    expect((err as Error & { code?: string }).code).toBe("PROVISION_TIMEOUT");
    expect(deprovisionCalled).toBe(true);

    Reflect.deleteProperty(providers, "hangroллbасk");
  });

  test("hanging materialize times out and rolls back secrets + calls deprovision", async () => {
    let deprovisionCalled = false;

    const provider: Provider = {
      name: "mathangsvc",
      displayName: "Mat Hang Service",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "tok" };
      },
      async provision() {
        return { id: "res-mathang", displayName: "mat-hang-db" };
      },
      async materialize() {
        // Hangs during key fetch.
        return new Promise<never>(() => {});
      },
      async deprovision() {
        deprovisionCalled = true;
      },
    };

    providers.mathangsvc = async () => provider;

    const err = await addService({
      providerName: "mathangsvc",
      cwd,
      interactive: false,
      timeoutMs: 100,
    })
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).not.toBeNull();
    expect((err as Error & { code?: string }).code).toBe("PROVISION_TIMEOUT");
    expect((err as Error).message).toMatch(/materialize/i);
    expect(deprovisionCalled).toBe(true);

    // .stack.toml must NOT have an entry.
    const config = await readConfig(cwd);
    expect(config.services.mathangsvc).toBeUndefined();

    // No secrets written (materialize never returned).
    const vault = await readVault(h.dir);
    expect(Object.keys(vault)).toHaveLength(0);

    Reflect.deleteProperty(providers, "mathangsvc");
  });

  test("hanging login times out with no rollback needed", async () => {
    const provider: Provider = {
      name: "loginhangsvc",
      displayName: "Login Hang Service",
      category: "api_key",
      authKind: "api_key",
      async login() {
        // Hangs waiting for OAuth redirect.
        return new Promise<never>(() => {});
      },
      async provision() {
        return { id: "should-not-reach", displayName: "n/a" };
      },
      async materialize() {
        return { secrets: {} };
      },
    };

    providers.loginhangsvc = async () => provider;

    const err = await addService({
      providerName: "loginhangsvc",
      cwd,
      interactive: false,
      timeoutMs: 100,
    })
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).not.toBeNull();
    expect((err as Error & { code?: string }).code).toBe("PROVISION_TIMEOUT");
    expect((err as Error).message).toMatch(/login/i);

    // No config entry — no provision was called at all.
    const config = await readConfig(cwd);
    expect(config.services.loginhangsvc).toBeUndefined();

    Reflect.deleteProperty(providers, "loginhangsvc");
  });

  test("timeout=0 disables the timeout (fast provider completes normally)", async () => {
    const provider: Provider = {
      name: "notimeoutsvc",
      displayName: "No Timeout Service",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "tok" };
      },
      async provision() {
        return { id: "res-notimeout", displayName: "notimeout-db" };
      },
      async materialize() {
        return { secrets: { NOTIMEOUT_KEY: "val" } };
      },
    };

    providers.notimeoutsvc = async () => provider;

    const result = await addService({
      providerName: "notimeoutsvc",
      cwd,
      interactive: false,
      timeoutMs: 0, // disabled
    });

    expect(result.providerName).toBe("notimeoutsvc");
    expect(result.secretCount).toBe(1);

    const config = await readConfig(cwd);
    expect(config.services.notimeoutsvc).toBeDefined();

    Reflect.deleteProperty(providers, "notimeoutsvc");
  });

  test("happy path with default timeout is unaffected", async () => {
    const provider: Provider = {
      name: "fastsvc",
      displayName: "Fast Service",
      category: "database",
      authKind: "api_key",
      async login() {
        return { token: "tok" };
      },
      async provision() {
        return { id: "res-fast", displayName: "fast-db" };
      },
      async materialize() {
        return { secrets: { FAST_KEY: "fast-val" } };
      },
    };

    providers.fastsvc = async () => provider;

    const result = await addService({
      providerName: "fastsvc",
      cwd,
      interactive: false,
      // no timeoutMs — uses default 30s
    });

    expect(result.providerName).toBe("fastsvc");
    expect(result.secretCount).toBe(1);

    const vault = await readVault(h.dir);
    expect(vault.FAST_KEY).toBe("fast-val");

    const config = await readConfig(cwd);
    expect(config.services.fastsvc).toBeDefined();

    Reflect.deleteProperty(providers, "fastsvc");
  });
});
