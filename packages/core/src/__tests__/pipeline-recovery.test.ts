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
 * Partial-failure regression: if `materialize()` throws after `provision()`
 * succeeded, we MUST still write a breadcrumb entry to .stack.toml so
 * `stack doctor --fix` / `stack remove` can find and clean up the dangling
 * upstream resource. Without this guard, the user ends up with a live
 * provider-side resource and no local record of it at all.
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

  test("writes a partial entry when materialize throws post-provision", async () => {
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
    };

    providers.partialsvc = async () => failingProvider;

    await expect(
      addService({ providerName: "partialsvc", cwd, interactive: false }),
    ).rejects.toThrow(/simulated materialize failure/);

    // Breadcrumb must be present so cleanup tooling can find the dangling resource.
    const config = await readConfig(cwd);
    expect(config.services.partialsvc).toBeDefined();
    expect(config.services.partialsvc.resource_id).toBe("partial-resource-42");
    expect(config.services.partialsvc.provider).toBe("partialsvc");
    expect(config.services.partialsvc.region).toBe("us-east-1");
    // We don't know what was materialized, so secrets must be empty.
    expect(config.services.partialsvc.secrets).toEqual([]);
    // Marker lets `stack doctor` distinguish partial rows from healthy ones.
    expect(config.services.partialsvc.created_by).toBe("stack add (partial)");

    delete providers.partialsvc;
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
    };

    providers.drypartialsvc = async () => failingProvider;

    await expect(
      addService({
        providerName: "drypartialsvc",
        cwd,
        interactive: false,
        persist: false,
      }),
    ).rejects.toThrow(/boom/);

    const config = await readConfig(cwd);
    expect(config.services.drypartialsvc).toBeUndefined();

    delete providers.drypartialsvc;
  });
});
