import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig, readConfig, writeConfig } from "../config.ts";
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
});
